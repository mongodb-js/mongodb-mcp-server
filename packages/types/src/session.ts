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
}

export interface IToolSession extends ISession {
    readonly keychain: IKeychain;
    readonly connectionStringInfo?: { authType?: string; hostType?: string };
    readonly connectedAtlasCluster?: { projectId?: string; clusterName?: string };
}
