import type { BaseEvent, CommonProperties } from "./types.js";
import type { LoggerBase } from "../common/logging/index.js";
import { LogId } from "../common/logging/index.js";
import type { ApiClient } from "../common/atlas/apiClient.js";
import { ApiClientError } from "../common/atlas/apiClientError.js";
import { MACHINE_METADATA } from "./constants.js";
import { EventCache } from "./eventCache.js";
import { detectContainerEnv } from "../helpers/container.js";
import type { DeviceId } from "../helpers/deviceId.js";
import type { Keychain } from "../common/keychain.js";
import { EventEmitter } from "events";
import { redact } from "mongodb-redact";
import { Timer } from "./timer.js";

type SendResult = {
    status: "success" | "rate-limited" | "error" | "empty";
    error?: Error;
};

export interface TelemetryEvents {
    "events-emitted": [];
    "events-send-failed": [];
    "events-skipped": [];
}

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
    private isBufferingEvents: boolean = true;
    /** Resolves when the setup is complete or a timeout occurs */
    public setupPromise: Promise<[string, boolean]> | undefined;
    public readonly events: EventEmitter<TelemetryEvents> = new EventEmitter();

    private readonly logger: LoggerBase;
    private readonly apiClient: ApiClient;
    private readonly keychain?: Keychain;
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
    private backoffMs: number = INITIAL_BACKOFF_MS;
    private readonly timer = new Timer();

    private constructor(config: TelemetryConfig) {
        this.logger = config.logger;
        this.apiClient = config.apiClient;
        this.keychain = config.keychain;
        this.telemetrySetting = config.telemetry;
        this.getHostCommonProperties = config.getCommonProperties ?? ((): Partial<CommonProperties> => ({}));
        this.eventCache = EventCache.getInstance();
        this.deviceId = config.deviceId;
        this.pipelineCommonProperties = {
            ...MACHINE_METADATA,
        };
    }

    static create(config: TelemetryConfig): Telemetry {
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
     *
     * Follows the Console Do Not Track standard
     * by respecting the DO_NOT_TRACK environment variable. The env check is
     * done on every call so an operator can opt out mid-process.
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
        if (this.eventCache.size === 0) return { status: "empty" };

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
    private async sendEvents(client: ApiClient, events: BaseEvent[], signal?: AbortSignal): Promise<SendResult> {
        try {
            const effectiveSignal = signal ?? AbortSignal.timeout(SEND_TIMEOUT_MS);
            const secrets = this.keychain?.allSecrets ?? [];
            await client.sendEvents(
                events.map((event) => ({
                    ...event,
                    properties: {
                        ...redact(this.getCommonProperties(), secrets),
                        ...redact(event.properties, secrets),
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
