/**
 * Lifecycle events emitted by the telemetry service.
 */
export interface TelemetryEvents {
    "events-emitted": [];
    "events-send-failed": [];
    "events-skipped": [];
}

/**
 * Public interface of the telemetry service.
 *
 * Concrete telemetry events and the underlying queue/cache implementation
 * live in `@mongodb-js/mcp-cli-telemetry`.
 */
export interface ITelemetry<TEvent = unknown, TCommonProperties = unknown> {
    /** Whether telemetry is currently enabled. */
    isTelemetryEnabled(): boolean;

    /**
     * Returns the common properties added to every telemetry event.
     */
    getCommonProperties(): TCommonProperties;

    /**
     * Caches events for sending via the background timer. Events are dropped
     * when telemetry is disabled.
     */
    emitEvents(events: TEvent[]): void;

    /**
     * Flushes a final batch (best-effort) and stops the background timer.
     */
    close(): Promise<void>;
}
