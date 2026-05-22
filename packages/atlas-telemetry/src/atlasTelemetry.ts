import type { TelemetryBaseEvent, TelemetryCommonProperties } from "./types.js";
import { LogId } from "@mongodb-js/mcp-core";
import { detectContainerEnv as detectContainerEnvImpl } from "./containerEnv.js";
import type { LoggerBase } from "@mongodb-js/mcp-core";
import type { ApiClient } from "@mongodb-js/mcp-atlas-api-client";
import { ApiClientError } from "@mongodb-js/mcp-atlas-api-client";
import { EventCache } from "./eventCache.js";
import type { IDeviceId, IKeychain, ITelemetry, ServerMetadata } from "@mongodb-js/mcp-types";
import { EventEmitter } from "events";
import { redact } from "mongodb-redact";
import { Timer } from "./timer.js";

import type { TelemetryEvents } from "@mongodb-js/mcp-types";

export type { TelemetryEvents };

type SendResult = {
    status: "success" | "rate-limited" | "error" | "empty";
    error?: Error;
};

/**
 * Configuration for the {@link Telemetry} pipeline.
 */
export type TelemetryConfig = {
    /** Logger used by the telemetry pipeline for its own diagnostics. */
    logger: LoggerBase;

    /** Device id source, resolved asynchronously during setup. */
    deviceId: IDeviceId;

    /**
     * API client used to send events. Always required — the pipeline would
     * otherwise buffer events in the cache forever. When no Atlas credentials
     * are configured, callers should still pass an unauthenticated
     * `ApiClient`; it will route telemetry through the unauth endpoint.
     */
    apiClient: ApiClient;

    /** Secrets source used when redacting events prior to sending. */
    keychain: IKeychain;

    /**
     * The user's telemetry preference. When set to `false`, no events are
     * cached or sent. The DO_NOT_TRACK environment variable is always honored
     * on top of this setting, so callers don't need to check it themselves.
     */
    enabled: boolean;

    /**
     * Server name/version and related metadata. The default
     * {@link AtlasTelemetry.getCommonProperties} implementation maps this to
     * telemetry fields; extend the class and override that method (calling
     * `super`) to add host-specific properties.
     */
    serverMetadata: ServerMetadata;

    /**
     * Optional override for the underlying event cache. Defaults to the
     * process-wide singleton returned by {@link EventCache.getInstance}.
     * Mostly useful for tests or callers that need to isolate caching.
     */
    eventCache?: EventCache;
};

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

export class AtlasTelemetry implements ITelemetry {
    /** Resolves when the setup is complete or a timeout occurs */
    public setupPromise: Promise<[string, boolean]> | undefined;
    public readonly events: EventEmitter<TelemetryEvents> = new EventEmitter();

    private readonly logger: LoggerBase;
    private readonly apiClient: ApiClient;
    private readonly keychain: IKeychain;
    private readonly enabled: boolean;
    protected readonly serverMetadata: ServerMetadata;
    /**
     * device_id and is_container_env, resolved during setup. Subclass overrides
     * of {@link getCommonProperties} should call `super` to include these.
     */
    private readonly pipelineCommonProperties: Partial<TelemetryCommonProperties>;
    private readonly eventCache: EventCache;
    private readonly deviceId: IDeviceId;
    private backoffMs: number = INITIAL_BACKOFF_MS;
    private readonly timer = new Timer();

    protected constructor(config: TelemetryConfig) {
        this.logger = config.logger;
        this.apiClient = config.apiClient;
        this.keychain = config.keychain;
        this.enabled = config.enabled;
        this.serverMetadata = config.serverMetadata;
        this.eventCache = config.eventCache ?? EventCache.getInstance();
        this.deviceId = config.deviceId;
        this.pipelineCommonProperties = {};
    }

    static create(this: typeof AtlasTelemetry, config: TelemetryConfig): AtlasTelemetry {
        const instance = new this(config);
        void instance.setup();
        return instance;
    }

    /**
     * Detects whether the process is running inside a container. Override in a
     * subclass for non-Node runtimes or custom detection. Defaults to
     * inspecting `/proc` and environment variables on Linux.
     */
    protected detectContainerEnv(): Promise<boolean> {
        return detectContainerEnvImpl();
    }

    protected async setup(): Promise<void> {
        if (!this.isTelemetryEnabled()) {
            this.logger.info({
                id: LogId.telemetryEmitFailure,
                context: "telemetry",
                message: "Telemetry is disabled.",
                noRedaction: true,
            });
            return;
        }

        this.setupPromise = Promise.all([this.deviceId.get(), this.detectContainerEnv()]);
        const [deviceIdValue, containerEnv] = await this.setupPromise;

        this.pipelineCommonProperties.device_id = deviceIdValue;
        this.pipelineCommonProperties.is_container_env = containerEnv ? "true" : "false";

        this.scheduleSend();
    }

    public async close(): Promise<void> {
        this.timer.cancel();

        this.logger.debug({
            id: LogId.telemetryClose,
            message: `Closing telemetry, attempting to flush up to ${BATCH_SIZE} of ${this.eventCache.size} remaining events`,
            context: "telemetry",
        });

        // Best-effort: send one final batch before closing, bounded by CLOSE_TIMEOUT_MS
        await this.sendBatch({ signal: AbortSignal.timeout(CLOSE_TIMEOUT_MS) });
    }

    /**
     * Caches events for sending via the background timer.
     */
    public emitEvents(events: TelemetryBaseEvent[]): void {
        if (!this.isTelemetryEnabled()) {
            this.events.emit("events-skipped");
            return;
        }
        this.eventCache.appendEvents(events);
    }

    /**
     * Returns common properties merged onto every event. Invoked on every send
     * so values resolved after construction — like MCP client identity — are
     * captured. Defaults to server/platform metadata plus pipeline-resolved
     * `device_id` and `is_container_env`. Extend {@link AtlasTelemetry} and
     * override this method (calling `super`) to add host-specific properties.
     */
    public getCommonProperties(): TelemetryCommonProperties {
        return {
            ...this.pipelineCommonProperties,
            mcp_server_version: this.serverMetadata.version,
            mcp_server_name: this.serverMetadata.mcpServerName,
            platform: (typeof process !== "undefined" && process.platform) || "browser",
            arch: (typeof process !== "undefined" && process.arch) || "unknown",
            os_type: (typeof process !== "undefined" && process.platform) || "unknown",
            os_version: (typeof process !== "undefined" && process.version) || "unknown",
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
     */
    private scheduleSend(delayMs: number = SEND_INTERVAL_MS): void {
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

            const sendResult = await this.sendEvents({ client: this.apiClient, events, signal });

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
    private async sendEvents({
        client,
        events,
        signal,
    }: {
        client: ApiClient;
        events: TelemetryBaseEvent[];
        signal?: AbortSignal;
    }): Promise<SendResult> {
        try {
            const effectiveSignal = signal ?? AbortSignal.timeout(SEND_TIMEOUT_MS);
            const secrets = this.keychain?.allSecrets ?? [];
            await client.sendEvents({
                events: events.map((event) => ({
                    ...event,
                    properties: {
                        ...redact(this.getCommonProperties(), secrets),
                        ...redact(event.properties, secrets),
                    },
                })),
                signal: effectiveSignal,
            });
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
