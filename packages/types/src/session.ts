import type { ICompositeLogger } from "./logging.js";
import type { IKeychain } from "./keychain.js";

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
    /** TODO: Consider removing if possible */
    setMcpClient(mcpClient: { name?: string; version?: string; title?: string } | undefined): void;
    disconnect(): Promise<void>;
    close(): Promise<void>;
    readonly isConnectedToMongoDB: boolean;
    /** Event emitter method for reactive resources */
    on(event: "connect" | "disconnect" | "close" | "connection-error", listener: (...args: unknown[]) => void): void;
}

export interface IToolSession extends ISession {
    readonly keychain: IKeychain;
    readonly connectionStringInfo?: { authType?: string; hostType?: string };
    readonly connectedAtlasCluster?: { projectId?: string; clusterName?: string };
}
