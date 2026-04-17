import type { BaseEvent, CommonProperties } from "./types.js";
import type { LoggerBase } from "../common/logging/index.js";
import { LogId } from "../common/logging/index.js";
import { ApiClient } from "../common/atlas/apiClient.js";
import { ApiClientError } from "../common/atlas/apiClientError.js";
import { MACHINE_METADATA } from "./constants.js";
import { EventCache } from "./eventCache.js";
import { detectContainerEnv } from "../helpers/container.js";
import type { DeviceId } from "../helpers/deviceId.js";
import { EventEmitter } from "events";
import { redact } from "mongodb-redact";
import { Timer } from "./timer.js";
import type { Keychain } from "../common/keychain.js";
import { Session } from "../common/session.js";
import type { UserConfig } from "../common/config/userConfig.js";

type SendResult = {
    status: "success" | "rate-limited" | "error" | "empty";
    error?: Error;
};

export interface TelemetryEvents {
    "events-emitted": [];
    "events-send-failed": [];
    "events-skipped": [];
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

/**
 * Configuration for the {@link Telemetry} pipeline.
 */
export type TelemetryConfig = {
    /** Logger used by the telemetry pipeline for its own diagnostics. */
    logger: LoggerBase;

    /** Device id source, resolved asynchronously during setup. */
    deviceId: DeviceId;

    /** Secrets source used when redacting events prior to sending. */
    keychain: Keychain;

    /**
     * The user's telemetry preference. When set to `"disabled"`, no events are
     * cached or sent. The DO_NOT_TRACK environment variable is always honored
     * on top of this setting, so callers don't need to check it themselves.
     */
    telemetry: "enabled" | "disabled";

    /**
     * Returns the host-supplied common properties merged onto every event
     * (e.g. hosting mode, MCP client identity, transport). Invoked on every
     * send so values resolved after construction — like the client name/
     * version exchanged during handshake — are captured. Static properties
     * can simply be returned as constants from this callback.
     *
     * Machine metadata, device id, and container environment are provided by
     * the pipeline itself and don't need to be returned here.
     */
    getCommonProperties?: () => Partial<CommonProperties>;
} & (
    | {
          /**
           * Pre-constructed client used to send events. Use this when the host
           * already has an {@link ApiClient} instance so telemetry can
           * reuse it instead of allocating a second client.
           */
          apiClient: ApiClient;
      }
    | {
          /**
           * Base URL for the Atlas API. When supplied instead of an
           * `apiClient`, the service lazily constructs an unauthenticated
           * {@link ApiClient} the first time it needs to send a batch — which
           * means disabled telemetry never allocates one. Events are routed
           * through the unauthenticated telemetry endpoint.
           */
          apiBaseUrl: string;
      }
);

export class Telemetry {
    private isBufferingEvents: boolean = true;
    /** Resolves when the setup is complete or a timeout occurs */
    public setupPromise: Promise<[string, boolean]> | undefined;
    public readonly events: EventEmitter<TelemetryEvents> = new EventEmitter();

    private backoffMs: number = INITIAL_BACKOFF_MS;
    private readonly timer = new Timer();

    private readonly logger: LoggerBase;
    /**
     * Either the caller-supplied client, or a `{ apiBaseUrl }` marker used to
     * lazily construct one on first send. Resolved through {@link resolveApiClient}
     * so disabled telemetry never allocates a client.
     */
    private apiClientSource: ApiClient | { apiBaseUrl: string };
    private readonly keychain: Keychain;
    private readonly telemetrySetting: "enabled" | "disabled";
    private readonly getHostCommonProperties: () => Partial<CommonProperties>;

    /**
     * Machine metadata plus device_id / is_container_env, which the pipeline
     * resolves itself during setup. Host-supplied properties are merged on
     * top of this at send time.
     */
    private readonly pipelineCommonProperties: CommonProperties;
    private readonly eventCache: EventCache;
    private readonly deviceId: DeviceId;

    private constructor(config: TelemetryConfig, eventCache: EventCache) {
        this.logger = config.logger;
        this.apiClientSource = "apiClient" in config ? config.apiClient : { apiBaseUrl: config.apiBaseUrl };
        this.keychain = config.keychain;
        this.telemetrySetting = config.telemetry;
        this.getHostCommonProperties = config.getCommonProperties ?? ((): Partial<CommonProperties> => ({}));
        this.eventCache = eventCache;
        this.deviceId = config.deviceId;
        this.pipelineCommonProperties = {
            ...MACHINE_METADATA,
        };
    }

    /**
     * Returns the {@link ApiClient}, constructing an unauthenticated one on
     * demand when the config only supplied an `apiBaseUrl`. Subsequent calls
     * reuse the same instance.
     */
    private resolveApiClient(): ApiClient {
        if (!(this.apiClientSource instanceof ApiClient)) {
            this.apiClientSource = new ApiClient({ baseUrl: this.apiClientSource.apiBaseUrl }, this.logger);
        }
        return this.apiClientSource;
    }

    /**
     * Constructs a {@link Telemetry} service and kicks off its asynchronous
     * setup. The returned instance is safe to use immediately — events emitted
     * before setup completes are buffered and flushed once the background send
     * loop starts.
     */
    static create(config: TelemetryConfig): Telemetry;
    /**
     * @deprecated Use the {@link TelemetryConfig}-based overload instead. This
     * signature is retained for backwards compatibility and will be removed in
     * a future release.
     */
    static create(
        session: Session,
        userConfig: UserConfig,
        deviceId: DeviceId,
        options?: {
            commonProperties?: Partial<CommonProperties>;
            eventCache?: EventCache;
        }
    ): Telemetry;
    static create(
        configOrSession: TelemetryConfig | Session,
        userConfig?: UserConfig,
        deviceId?: DeviceId,
        {
            commonProperties = {},
            eventCache = EventCache.getInstance(),
        }: {
            commonProperties?: Partial<CommonProperties>;
            eventCache?: EventCache;
        } = {}
    ): Telemetry {
        const resolvedConfig: TelemetryConfig =
            configOrSession instanceof Session
                ? Telemetry.buildLegacyConfig(configOrSession, userConfig, deviceId, commonProperties)
                : configOrSession;

        const instance = new Telemetry(resolvedConfig, eventCache);

        void instance.setup();
        return instance;
    }

    private static buildLegacyConfig(
        session: Session,
        userConfig: UserConfig | undefined,
        deviceId: DeviceId | undefined,
        commonProperties: Partial<CommonProperties>
    ): TelemetryConfig {
        if (!userConfig || !deviceId) {
            throw new TypeError(
                "Telemetry.create(session, userConfig, deviceId, ...) requires userConfig and deviceId to be provided."
            );
        }

        return {
            logger: session.logger,
            deviceId,
            ...(session.apiClient ? { apiClient: session.apiClient } : { apiBaseUrl: userConfig.apiBaseUrl }),
            keychain: session.keychain,
            telemetry: userConfig.telemetry,
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

        this.isBufferingEvents = false;
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
    public emitEvents(events: BaseEvent[]): void {
        if (!this.isTelemetryEnabled()) {
            this.events.emit("events-skipped");
            return;
        }
        this.eventCache.appendEvents(events);
    }

    /**
     * Gets the common properties for events
     */
    public getCommonProperties(): CommonProperties {
        return {
            ...this.pipelineCommonProperties,
            ...this.getHostCommonProperties(),
        };
    }

    /**
     * Checks if telemetry is currently enabled.
     * This is a method rather than a constant to capture runtime config changes.
     *
     * Follows the Console Do Not Track standard (https://consoledonottrack.com/)
     * by respecting the DO_NOT_TRACK environment variable.
     */
    public isTelemetryEnabled(): boolean {
        return this.telemetrySetting !== "disabled" && !("DO_NOT_TRACK" in process.env);
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

            const sendResult = await this.sendEvents(this.resolveApiClient(), events, signal);

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
    private async sendEvents(client: ApiClient, events: BaseEvent[], signal?: AbortSignal): Promise<SendResult> {
        try {
            const effectiveSignal = signal ?? AbortSignal.timeout(SEND_TIMEOUT_MS);
            await client.sendEvents(
                events.map((event) => ({
                    ...event,
                    properties: {
                        ...redact(this.getCommonProperties(), this.keychain.allSecrets),
                        ...redact(event.properties, this.keychain.allSecrets),
                    },
                })),
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
