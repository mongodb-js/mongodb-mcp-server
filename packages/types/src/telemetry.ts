export type TelemetryEvents = {
    "events-emitted": [];
    "events-send-failed": [];
    "events-skipped": [];
};

export interface ITelemetry {
    isTelemetryEnabled(): boolean;
    emitEvents(events: unknown[]): void;
    close(): Promise<void>;
}
