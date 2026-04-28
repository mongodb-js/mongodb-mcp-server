import type { ICompositeLogger } from "./logging.js";

export type SessionEvents = {
    connect: [];
    close: [];
    disconnect: [];
    "connection-error": [unknown];
};

export interface ISession {
    readonly sessionId: string;
    logger: ICompositeLogger;
    mcpClient?: { name?: string; version?: string; title?: string };
    setMcpClient(mcpClient: { name?: string; version?: string; title?: string } | undefined): void;
    disconnect(): Promise<void>;
    close(): Promise<void>;
    readonly isConnectedToMongoDB: boolean;
    on<K extends keyof SessionEvents>(event: K, listener: (...args: SessionEvents[K]) => void): this;
}
