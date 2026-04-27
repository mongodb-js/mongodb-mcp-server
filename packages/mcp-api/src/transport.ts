export type TransportRequestContext = {
    headers?: Record<string, string | string[] | undefined>;
    query?: Record<string, string | string[] | undefined>;
};

export interface ITransportRunner {
    start(options: { serverOptions?: unknown; sessionOptions?: unknown }): Promise<void>;
    closeTransport(): Promise<void>;
    close(): Promise<void>;
}

export interface IServerFactory {
    createServer(options: unknown): Promise<unknown>;
}
