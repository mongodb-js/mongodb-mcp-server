export interface ApiClientLike {
    isAuthConfigured(): boolean;
    close(): Promise<void>;
    sendEvents(events: unknown[], options?: { signal?: AbortSignal }): Promise<void>;
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
