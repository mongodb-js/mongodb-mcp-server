import type { Implementation } from "@modelcontextprotocol/sdk/types.js";
import type { ICompositeLogger } from "./logging.js";
import type { IKeychain } from "./keychain.js";
import type { ApiClientLike } from "./apiClient.js";

/**
 * Events emitted by an `ISession` instance over its lifetime.
 *
 * The actual payload for `connection-error` is supplied by concrete
 * implementations of the connection manager.
 */
export type SessionEvents = {
    connect: [];
    close: [];
    disconnect: [];
    "connection-error": [unknown];
};

/**
 * Identifying information about the connected MCP client.
 */
export interface McpClientInfo {
    name?: string;
    version?: string;
    title?: string;
}

/**
 * Public interface for an MCP session. Concrete implementations live in
 * `@mongodb-js/mcp-core`.
 */
export interface ISession {
    /** Unique identifier for this session. */
    readonly sessionId: string;

    /** Information about the connected MCP client, populated after handshake. */
    mcpClient?: McpClientInfo;

    /** Composite logger for this session. */
    readonly logger: ICompositeLogger;

    /** Keychain holding secrets to be redacted from logs. */
    readonly keychain: IKeychain;

    /** Atlas API client associated with this session. */
    readonly apiClient: ApiClientLike;

    /** Connection manager for MongoDB deployments (concrete type in mcp-core). */
    readonly connectionManager: unknown;

    /** Exports manager for this session (concrete type in mcp-core). */
    readonly exportsManager: unknown;

    /** Service provider for the active MongoDB connection (concrete type in mcp-core). */
    readonly serviceProvider: unknown;

    /** Connected Atlas cluster info, if any (concrete type in mcp-core). */
    readonly connectedAtlasCluster: unknown;

    /** Parsed connection string info, if any (concrete type in mcp-core). */
    readonly connectionStringInfo: unknown;

    /** Atlas Local client, if any (concrete type in mcp-core). */
    readonly atlasLocalClient?: unknown;

    /** Error handler for connection errors (concrete type in mcp-core). */
    readonly connectionErrorHandler: unknown;

    /**
     * Stores the connected MCP client's name/version/title and propagates the
     * client name to the underlying connection manager.
     */
    setMcpClient(mcpClient: Implementation | undefined): void;

    /**
     * Closes the underlying MongoDB connection (if any) and cleans up any
     * temporary Atlas database users created by this session.
     */
    disconnect(): Promise<void>;

    /**
     * Closes the session, releasing all resources (connections, exports
     * manager, API client). Emits the `close` event.
     */
    close(): Promise<void>;

    /**
     * Connects to the MongoDB deployment described by the session's user
     * configuration.
     */
    connectToConfiguredConnection(): Promise<void>;

    /**
     * Connects to a MongoDB deployment using the supplied connection settings.
     * The shape of `settings` is defined by the concrete connection manager.
     */
    connectToMongoDB(settings: unknown): Promise<void>;

    /** Whether the session currently has an active MongoDB connection. */
    readonly isConnectedToMongoDB: boolean;

    /**
     * Whether Atlas Search is supported by the currently connected MongoDB
     * deployment.
     */
    isSearchSupported(): Promise<boolean>;

    /**
     * Throws if Atlas Search is not supported by the currently connected
     * MongoDB deployment.
     */
    assertSearchSupported(): Promise<void>;

}
