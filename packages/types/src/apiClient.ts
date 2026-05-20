import type { TelemetryCommonProperties, TelemetryEvent } from "./telemetry.js";

export interface IApiClient<TEvent extends unknown[] = TelemetryEvent<TelemetryCommonProperties>[]> {
    isAuthConfigured(): boolean;
    close(): Promise<void>;
    validateAuthConfig(): Promise<void>;
    sendEvents(options?: { signal?: AbortSignal; events: TEvent }): Promise<void>;
}

export type ApiClientOptions = {
    baseUrl: string;
    userAgent?: string;
    requestContext?: {
        headers?: Record<string, string | string[] | undefined>;
    };
};
