import type { BaseEvent, CommonProperties, TelemetryEvent } from "./types.js";
import type { LoggerBase } from "../common/logging/index.js";
import { LogId } from "../common/logging/index.js";
import type { ApiClient } from "../common/atlas/apiClient.js";
import { ApiClientError } from "../common/atlas/apiClientError.js";
import { MACHINE_METADATA } from "./constants.js";
import { EventCache } from "./eventCache.js";
import { detectContainerEnv } from "../helpers/container.js";
import type { DeviceId } from "../helpers/deviceId.js";
import type { Keychain } from "../common/keychain.js";
import type { Session } from "../common/session.js";
import type { UserConfig } from "../common/config/userConfig.js";
import { EventEmitter } from "events";
import { redact } from "mongodb-redact";
import { Timer } from "./timer.js";

type SendResult = {
    status: "success" | "rate-limited" | "error" | "empty";
    error?: Error;
};

import type { TelemetryEvents } from "@mongodb-js/mcp-types";

export type { TelemetryEvents };

/**
 * Configuration for the {@link Telemetry} pipeline.
 */
export interface TelemetryConfig {
    /** Logger used by the telemetry pipeline for its own diagnostics. */
    logger: LoggerBase;

    /** Device id source, resolved asynchronously during setup. */
    deviceId: DeviceId;

    /**
     * API client used to send events. Always required — the pipeline would
     * otherwise buffer events in the cache forever. When no Atlas credentials
     * are configured, callers should still pass an unauthenticated
     * {@link ApiClient}; it will route telemetry through the unauth endpoint.
     */
    apiClient: ApiClient;

    /** Secrets source used when redacting events prior to sending. */
    keychain?: Keychain;

    /**
     * The user's telemetry preference. When set to `false`, no events are
     * cached or sent. The DO_NOT_TRACK environment variable is always honored
     * on top of this setting, so callers don't need to check it themselves.
     */
    enabled: boolean;

    /**
     * Returns the host-supplied common properties merged onto every event
     * (e.g. hosting mode, MCP client identity, transport). Invoked when
     * events are emitted, so each event carries the properties of the
     * pipeline that produced it; values like the MCP client name/version
     * must be available before the events that should carry them are
     * emitted. Static properties can simply be returned as constants.
     *
     * Machine metadata, device id, and container environment are provided by
     * the pipeline itself and don't need to be returned here.
     */
    getCommonProperties?: () => Partial<CommonProperties>;

    /**
     * Optional override for the underlying event cache. Defaults to a new
     * cache owned exclusively by this pipeline, so events are only ever sent
     * through the pipeline (and API client) that emitted them. Holds events
     * that already include this pipeline's common properties.
     */
    eventCache?: EventCache<TelemetryEvent<CommonProperties>>;
}

/** The timeout for individual send requests in milliseconds. */
const SEND_TIMEOUT_MS = 5_000;

/** How long close() waits for a final flush before giving up. */
const CLOSE_TIMEOUT_MS = 5_000;

/** Maximum number of events sent per batch. */
export const BATCH_SIZE = 32;

/** Delay between send attempts under normal conditions. */
export const SEND_INTERVAL_MS = 30_000;

/** Initial backoff delay after a 429 response. */
export const INITIAL_BACKOFF_MS = 60_000;

/** Maximum backoff delay (1 hour). */
export const MAX_BACKOFF_MS = 3_600_000;

/**
 * Calculates the next backoff duration, doubling the current value up to MAX_BACKOFF_MS.
 */
export function nextBackoffMs(currentMs: number): number {
    return Math.min(currentMs * 2, MAX_BACKOFF_MS);
}

export class Telemetry {
    /** Resolves when the setup is complete or a timeout occurs */
    public setupPromise: Promise<[string, boolean]> | undefined;
    public readonly events: EventEmitter<TelemetryEvents> = new EventEmitter();

    private readonly logger: LoggerBase;
    private readonly apiClient: ApiClient;
    private readonly keychain?: Keychain;
    private readonly enabled: boolean;
    private readonly getHostCommonProperties: () => Partial<CommonProperties>;
    /**
     * Machine metadata plus device_id / is_container_env, which the pipeline
     * resolves itself during setup. Host-supplied properties are merged on
     * top of this at send time.
     */
    private readonly pipelineCommonProperties: CommonProperties;
    private readonly eventCache: EventCache<TelemetryEvent<CommonProperties>>;
    private readonly deviceId: DeviceId;
    private backoffMs: number = INITIAL_BACKOFF_MS;
    private readonly timer = new Timer();
    private closed = false;

    private constructor(config: TelemetryConfig) {
        this.logger = config.logger;
        this.apiClient = config.apiClient;
        this.keychain = config.keychain;
        this.enabled = config.enabled;
        this.getHostCommonProperties = config.getCommonProperties ?? ((): Partial<CommonProperties> => ({}));
        this.eventCache = config.eventCache ?? new EventCache<TelemetryEvent<CommonProperties>>();
        this.deviceId = config.deviceId;
        this.pipelineCommonProperties = {
            ...MACHINE_METADATA,
        };
    }

    /**
     * @deprecated Pass a {@link TelemetryConfig} object instead. This
     * positional-argument overload is preserved for backward compatibility
     * and will be removed in the next major version.
     */
    static create(
        session: Session,
        userConfig: UserConfig,
        deviceId: DeviceId,
        options?: {
            commonProperties?: Partial<CommonProperties>;
            eventCache?: EventCache<TelemetryEvent<CommonProperties>>;
        }
    ): Telemetry;
    static create(config: TelemetryConfig): Telemetry;
    static create(
        sessionOrConfig: Session | TelemetryConfig,
        userConfig?: UserConfig,
        deviceId?: DeviceId,
        {
            commonProperties = {},
            eventCache,
        }: {
            commonProperties?: Partial<CommonProperties>;
            eventCache?: EventCache<TelemetryEvent<CommonProperties>>;
        } = {}
    ): Telemetry {
        const config: TelemetryConfig =
            userConfig === undefined || deviceId === undefined
                ? (sessionOrConfig as TelemetryConfig)
                : legacyConfigFromSession(sessionOrConfig as Session, userConfig, deviceId, {
                      commonProperties,
                      eventCache,
                  });

        const instance = new Telemetry(config);
        void instance.setup();
        return instance;
    }

    private async setup(): Promise<void> {
        if (!this.isTelemetryEnabled()) {
            this.logger.info({
                id: LogId.telemetryEmitFailure,
                context: "telemetry",
                message: "Telemetry is disabled.",
                noRedaction: true,
            });
            return;
        }

        this.setupPromise = Promise.all([this.deviceId.get(), detectContainerEnv()]);
        const [deviceIdValue, containerEnv] = await this.setupPromise;

        this.pipelineCommonProperties.device_id = deviceIdValue;
        this.pipelineCommonProperties.is_container_env = containerEnv ? "true" : "false";

        this.scheduleSend();
    }

    public async close(): Promise<void> {
        // Set before cancelling so that a setup() still in flight cannot schedule a new send afterwards.
        this.closed = true;
        this.timer.cancel();

        // The whole close is best-effort and bounded by CLOSE_TIMEOUT_MS: waiting for
        // setup (so events emitted before it finished make it into the cache) and the
        // final flush share the same budget, so a hung setup cannot block shutdown.
        const signal = AbortSignal.timeout(CLOSE_TIMEOUT_MS);
        await Promise.race([
            this.whenReady(),
            new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true })),
        ]);

        this.logger.debug({
            id: LogId.telemetryClose,
            message: `Closing telemetry, attempting to flush up to ${BATCH_SIZE} of ${this.eventCache.size} remaining events`,
            context: "telemetry",
        });

        await this.sendBatch({ signal });
    }

    /**
     * Merges the common properties into the events and caches them for
     * sending via the background timer.
     *
     * The merge is deferred until setup has resolved `device_id` and
     * `is_container_env`. Callbacks chained on an already-settled promise run
     * in registration order, so events are cached in the order they were emitted.
     */
    public emitEvents(events: BaseEvent[]): void {
        if (!this.isTelemetryEnabled()) {
            this.events.emit("events-skipped");
            return;
        }
        this.whenReady()
            .then(() => {
                const commonProperties = this.getCommonProperties();
                this.eventCache.appendEvents(
                    events.map((event) => ({
                        ...event,
                        properties: { ...commonProperties, ...event.properties },
                    }))
                );
            })
            .catch((error: unknown) => {
                // Telemetry must never take the process down via an unhandled rejection,
                // e.g. when a getCommonProperties override throws.
                this.logger.debug({
                    id: LogId.telemetryEmitFailure,
                    context: "telemetry",
                    message: `Error caching telemetry events: ${error instanceof Error ? error.message : String(error)}`,
                    noRedaction: true,
                });
            });
    }

    /**
     * Resolves once setup has completed (or immediately if setup never ran).
     * Never rejects — a failed setup must not turn emitEvents into an unhandled rejection.
     */
    private whenReady(): Promise<void> {
        return (this.setupPromise ?? Promise.resolve()).then(
            () => undefined,
            () => undefined
        );
    }

    /**
     * Returns common properties merged onto every event at emit time, so each
     * event carries the identity of the pipeline that produced it. Defaults to
     * machine metadata plus pipeline-resolved `device_id` and
     * `is_container_env`, with the host-supplied properties from
     * {@link TelemetryConfig.getCommonProperties} merged on top; those must be
     * available before the events that should carry them are emitted.
     */
    public getCommonProperties(): CommonProperties {
        return {
            ...this.pipelineCommonProperties,
            ...this.getHostCommonProperties(),
        };
    }

    /**
     * Checks if telemetry is currently enabled.
     *
     * Follows the Console Do Not Track standard
     * by respecting the DO_NOT_TRACK environment variable. The env check is
     * done on every call so an operator can opt out mid-process.
     */
    public isTelemetryEnabled(): boolean {
        if (!this.enabled) {
            return false;
        }

        // In browser environments, we don't have access to the process object, so we default to true.
        if (typeof process === "undefined" || !process.env) {
            return true;
        }

        // In Node.js environments, we check the DO_NOT_TRACK environment variable.
        return !("DO_NOT_TRACK" in process.env);
    }

    /**
     * Schedules the next send attempt. Replaces any previously scheduled send.
     * No-op once close() has been called.
     */
    private scheduleSend(delayMs: number = SEND_INTERVAL_MS): void {
        if (this.closed) {
            return;
        }
        this.timer.schedule(() => {
            void this.sendBatchAndReschedule();
        }, delayMs);
    }

    /**
     * Sends a batch and reschedules the next attempt based on the result.
     */
    private async sendBatchAndReschedule(): Promise<void> {
        const result = await this.sendBatch();
        const delay = this.getNextDelay(result);
        this.scheduleSend(delay);
    }

    /**
     * Determines the next send delay based on the result of the last batch.
     * On rate-limit: uses and advances exponential backoff.
     * On success: resets backoff and returns the normal interval.
     * On error/empty: returns the normal interval without changing backoff state.
     */
    private getNextDelay(result: SendResult): number {
        if (result.status === "rate-limited") {
            const delay = this.backoffMs;
            this.backoffMs = nextBackoffMs(this.backoffMs);
            this.logger.debug({
                id: LogId.telemetryRateLimited,
                context: "telemetry",
                message: `Rate limited. Backing off for ${delay}ms, next backoff will be ${this.backoffMs}ms`,
                noRedaction: true,
            });
            return delay;
        }

        if (result.status === "success") {
            this.backoffMs = INITIAL_BACKOFF_MS;
        }

        return SEND_INTERVAL_MS;
    }

    /**
     * Sends up to BATCH_SIZE oldest events from the cache.
     * On success the sent events are removed; on failure they stay in the cache.
     * Does not reschedule — the caller decides what to do next.
     */
    private async sendBatch({ signal }: { signal?: AbortSignal } = {}): Promise<SendResult> {
        if (this.eventCache.size === 0) {
            return { status: "empty" };
        }

        const result = await this.eventCache.processOldestBatch(BATCH_SIZE, async (events) => {
            this.logger.debug({
                id: LogId.telemetryEmitStart,
                context: "telemetry",
                message: `Attempting to send ${events.length} events`,
            });

            const sendResult = await this.sendEvents(this.apiClient, events, signal);

            if (sendResult.status !== "success") {
                if (sendResult.status !== "rate-limited") {
                    this.logger.debug({
                        id: LogId.telemetryEmitFailure,
                        context: "telemetry",
                        message: `Error sending telemetry: ${sendResult.error?.message ?? "unknown error"}`,
                        noRedaction: true,
                    });
                }
                this.events.emit("events-send-failed");
                return { removeProcessed: false, result: sendResult };
            }

            this.logger.debug({
                id: LogId.telemetryEmitSuccess,
                context: "telemetry",
                message: `Sent ${events.length} events successfully`,
            });
            this.events.emit("events-emitted");
            return { removeProcessed: true, result: sendResult };
        });

        return result ?? { status: "empty" };
    }

    /**
     * Sends events through the API client after redacting sensitive data.
     */
    private async sendEvents(
        client: ApiClient,
        events: TelemetryEvent<CommonProperties>[],
        signal?: AbortSignal
    ): Promise<SendResult> {
        try {
            const effectiveSignal = signal ?? AbortSignal.timeout(SEND_TIMEOUT_MS);
            const secrets = this.keychain?.allSecrets ?? [];
            await client.sendEvents(
                events.map((event) => ({ ...event, properties: redact(event.properties, secrets) })),
                { signal: effectiveSignal }
            );
            return { status: "success" };
        } catch (error) {
            if (error instanceof ApiClientError && error.response.status === 429) {
                return { status: "rate-limited", error };
            }
            return {
                status: "error",
                error: error instanceof Error ? error : new Error(String(error)),
            };
        }
    }
}

/**
 * Translates the legacy (session, userConfig, deviceId, options) inputs
 * accepted by the deprecated {@link Telemetry.create} overload into a
 * {@link TelemetryConfig}.
 */
function legacyConfigFromSession(
    session: Session,
    userConfig: UserConfig,
    deviceId: DeviceId,
    {
        commonProperties,
        eventCache,
    }: {
        commonProperties: Partial<CommonProperties>;
        eventCache?: EventCache<TelemetryEvent<CommonProperties>>;
    }
): TelemetryConfig {
    return {
        logger: session.logger,
        deviceId,
        apiClient: session.apiClient,
        keychain: session.keychain,
        enabled: userConfig.telemetry === "enabled",
        eventCache,
        getCommonProperties: () => ({
            ...commonProperties,
            transport: userConfig.transport,
            mcp_client_version: session.mcpClient?.version,
            mcp_client_name: session.mcpClient?.name,
            session_id: session.sessionId,
            config_atlas_auth: session.apiClient?.isAuthConfigured() ? "true" : "false",
            config_connection_string: userConfig.connectionString ? "true" : "false",
        }),
    };
}
