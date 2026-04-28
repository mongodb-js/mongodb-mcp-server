export interface IApiClient<TEvent extends unknown[] = unknown[]> {
    isAuthConfigured(): boolean;
    close(): Promise<void>;
    sendEvents(options?: { signal?: AbortSignal; events: TEvent }): Promise<void>;
}

export type ApiClientOptions = {
    baseUrl: string;
    userAgent?: string;
    credentials?: {
        clientId: string;
        clientSecret: string;
    };
    requestContext?: {
        headers?: Record<string, string | string[] | undefined>;
    };
};
