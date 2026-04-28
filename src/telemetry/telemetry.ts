import type { Session } from "../common/session.js";
import type { BaseEvent, CommonProperties } from "./types.js";
import type { UserConfig } from "../common/config/userConfig.js";
import { LogId } from "../common/logging/index.js";
import type { ApiClient } from "../common/atlas/apiClient.js";
import { ApiClientError } from "../common/atlas/apiClientError.js";
import { MACHINE_METADATA } from "./constants.js";
import { EventCache } from "./eventCache.js";
import { detectContainerEnv } from "../helpers/container.js";
import type { DeviceId } from "../helpers/deviceId.js";
import { EventEmitter } from "events";
import { redact } from "mongodb-redact";
import { Timer } from "./timer.js";

type SendResult = {
    status: "success" | "rate-limited" | "error" | "empty";
    error?: Error;
};

import type { TelemetryEvents } from "@mongodb-js/mcp-types";

export type { TelemetryEvents };

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

    private eventCache: EventCache;
    private deviceId: DeviceId;
    private backoffMs: number = INITIAL_BACKOFF_MS;
    private readonly timer = new Timer();

    private constructor(
        private readonly session: Session,
        private readonly userConfig: UserConfig,
        private readonly commonProperties: CommonProperties,
        { eventCache, deviceId }: { eventCache: EventCache; deviceId: DeviceId }
    ) {
        this.eventCache = eventCache;
        this.deviceId = deviceId;
    }

    static create(
        session: Session,
        userConfig: UserConfig,
        deviceId: DeviceId,
        {
            commonProperties = {},
            eventCache = EventCache.getInstance(),
        }: {
            commonProperties?: Partial<CommonProperties>;
            eventCache?: EventCache;
        } = {}
    ): Telemetry {
        const mergedProperties = {
            ...MACHINE_METADATA,
            ...commonProperties,
        };
        const instance = new Telemetry(session, userConfig, mergedProperties, {
            eventCache,
            deviceId,
        });

        void instance.setup();
        return instance;
    }

    private async setup(): Promise<void> {
        if (!this.isTelemetryEnabled()) {
            this.session.logger.info({
                id: LogId.telemetryEmitFailure,
                context: "telemetry",
                message: "Telemetry is disabled.",
                noRedaction: true,
            });
            return;
        }

        this.setupPromise = Promise.all([this.deviceId.get(), detectContainerEnv()]);
        const [deviceIdValue, containerEnv] = await this.setupPromise;

        this.commonProperties.device_id = deviceIdValue;
        this.commonProperties.is_container_env = containerEnv ? "true" : "false";

        this.isBufferingEvents = false;
        this.scheduleSend();
    }

    public async close(): Promise<void> {
        this.timer.cancel();

        this.session.logger.debug({
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
            ...this.commonProperties,
            transport: this.userConfig.transport,
            mcp_client_version: this.session.mcpClient?.version,
            mcp_client_name: this.session.mcpClient?.name,
            session_id: this.session.sessionId,
            config_atlas_auth: this.session.apiClient?.isAuthConfigured() ? "true" : "false",
            config_connection_string: this.userConfig.connectionString ? "true" : "false",
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
        if (this.userConfig.telemetry === "disabled") {
            return false;
        }

        // In browser environments, we don't have access to the process object, so we default to true.
        if (typeof process === "undefined" || !process.env) {
            return true;
        }

        // In Node.js environments, we check the DO_NOT_TRACK environment variable.
        const doNotTrack = "DO_NOT_TRACK" in process.env;
        return !doNotTrack;
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
            this.session.logger.debug({
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
            this.session.logger.debug({
                id: LogId.telemetryEmitStart,
                context: "telemetry",
                message: `Attempting to send ${events.length} events`,
            });

            const sendResult = await this.sendEvents(this.session.apiClient, events, signal);

            if (sendResult.status !== "success") {
                if (sendResult.status !== "rate-limited") {
                    this.session.logger.debug({
                        id: LogId.telemetryEmitFailure,
                        context: "telemetry",
                        message: `Error sending telemetry: ${sendResult.error?.message ?? "unknown error"}`,
                        noRedaction: true,
                    });
                }
                this.events.emit("events-send-failed");
                return { removeProcessed: false, result: sendResult };
            }

            this.session.logger.debug({
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
                        ...redact(this.getCommonProperties(), this.session.keychain.allSecrets),
                        ...redact(event.properties, this.session.keychain.allSecrets),
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
