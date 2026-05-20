import type { TelemetryCommonProperties, TelemetryEvent } from "./telemetry.js";

export interface IApiClient<TEvent extends unknown[] = TelemetryEvent<TelemetryCommonProperties>[]> {
    isAuthConfigured(): boolean;
    close(): Promise<void>;
    validateAuthConfig(): Promise<void>;
    sendEvents(options?: { signal?: AbortSignal; events: TEvent }): Promise<void>;
}
