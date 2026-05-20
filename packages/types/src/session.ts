import type { ICompositeLogger } from "./logging.js";
import type { IKeychain } from "./keychain.js";
import type { IToolConfig } from "./config.js";

export type SessionEvents = {
    connect: [];
    close: [];
    disconnect: [];
    "connection-error": [unknown];
};

export interface ISession<TConfig extends IToolConfig = IToolConfig> {
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
    /** Keychain for secret management */
    readonly keychain: IKeychain;
    /** Configuration for the session */
    readonly config: TConfig;
    /** Optional connection string info */
    readonly connectionStringInfo?: { authType?: string; hostType?: string };
    /** Optional connected Atlas cluster info */
    readonly connectedAtlasCluster?: { projectId?: string; clusterName?: string };
}
