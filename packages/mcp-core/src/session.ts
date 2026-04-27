import { ObjectId } from "bson";
import type { Implementation } from "@modelcontextprotocol/sdk/types.js";
import EventEmitter from "events";
import { generateConnectionInfoFromCliArgs } from "@mongosh/arg-parser";
import type { ApiClientLike, ISession } from "@mongodb-js/mcp-api";
import type { CompositeLogger } from "./logging/index.js";
import { LogId } from "./logging/index.js";
import type { Keychain } from "./keychain.js";
import { ErrorCodes, MongoDBError } from "./errors.js";

/**
 * Minimal structural shape of `connectionStringInfo` used by `Session`.
 *
 * Matches the public `ConnectionStringInfo` interface that lives outside of
 * mcp-core (in the connection manager module).
 */
export interface ConnectionStringInfoLike {
    authType: string;
    hostType: string;
}

/**
 * Minimal structural shape of `connectedAtlasCluster` used by `Session`.
 */
export interface AtlasClusterConnectionInfoLike {
    username: string;
    projectId: string;
    clusterName: string;
    expiryDate: Date;
}

/**
 * Settings accepted by the connection manager's `connect()` method. The exact
 * shape is implementation-defined — `Session` only forwards it.
 */
export type ConnectionSettingsLike = Record<string, unknown>;

/**
 * Errored connection state, narrow enough for Session's event re-emit.
 */
export type ConnectionStateErroredLike = { tag: "errored" } & Record<string, unknown>;

/**
 * Structural shape of `currentConnectionState` used by `Session`.
 */
export interface ConnectionStateLike {
    tag: string;
    serviceProvider?: unknown;
    isSearchSupported?: () => Promise<boolean>;
    connectedAtlasCluster?: AtlasClusterConnectionInfoLike;
    connectionStringInfo?: ConnectionStringInfoLike;
}

/**
 * Minimal structural interface that Session needs from a ConnectionManager.
 *
 * A connection manager exposes connect/close/setClientName methods, an event
 * emitter, and a `currentConnectionState` accessor. The full implementation
 * lives outside of mcp-core (in the binary or a dedicated transport package).
 */
export interface ConnectionManagerLike {
    readonly events: {
        on(event: "connection-success", listener: () => void): unknown;
        on(event: "connection-time-out", listener: (error: ConnectionStateErroredLike) => void): unknown;
        on(event: "connection-close", listener: () => void): unknown;
        on(event: "connection-error", listener: (error: ConnectionStateErroredLike) => void): unknown;
        on(event: string, listener: (...args: unknown[]) => void): unknown;
    };
    readonly currentConnectionState: ConnectionStateLike;
    setClientName(name: string): void;
    close(): Promise<unknown>;
    connect(settings: ConnectionSettingsLike): Promise<unknown>;
}

/**
 * Minimal structural interface that Session needs from an ExportsManager.
 */
export interface ExportsManagerLike {
    close(): Promise<void>;
}

/**
 * Connection error handler — opaque to Session, just stored.
 */
export type ConnectionErrorHandlerLike = (...args: unknown[]) => unknown;

/**
 * Atlas Local client — opaque to Session, just stored.
 */
export type AtlasLocalClientLike = unknown;

/**
 * Subset of UserConfig fields read by `Session`.
 *
 * Intentionally minimal so `mcp-core` doesn't depend on the binary's
 * `UserConfig` schema. Pass-through fields are listed via the index signature
 * so that `generateConnectionInfoFromCliArgs` can spread the entire config.
 */
export interface SessionConfig {
    /** MongoDB connection string (URI). */
    connectionString?: string;
    /** Allow additional fields used by `generateConnectionInfoFromCliArgs`. */
    [key: string]: unknown;
}

export interface SessionOptions {
    userConfig: SessionConfig;
    logger: CompositeLogger;
    exportsManager: ExportsManagerLike;
    connectionManager: ConnectionManagerLike;
    keychain: Keychain;
    atlasLocalClient?: AtlasLocalClientLike;
    connectionErrorHandler: ConnectionErrorHandlerLike;
    apiClient: ApiClientLike;
}

export type SessionEvents = {
    connect: [];
    close: [];
    disconnect: [];
    "connection-error": [ConnectionStateErroredLike];
};

export class Session extends EventEmitter<SessionEvents> implements ISession {
    private readonly userConfig: SessionConfig;
    readonly sessionId: string = new ObjectId().toString();
    readonly exportsManager: ExportsManagerLike;
    readonly connectionManager: ConnectionManagerLike;
    readonly apiClient: ApiClientLike;
    readonly atlasLocalClient?: AtlasLocalClientLike;
    readonly keychain: Keychain;
    readonly connectionErrorHandler: ConnectionErrorHandlerLike;

    mcpClient?: {
        name?: string;
        version?: string;
        title?: string;
    };

    public logger: CompositeLogger;

    constructor({
        userConfig,
        logger,
        connectionManager,
        exportsManager,
        keychain,
        atlasLocalClient,
        connectionErrorHandler,
        apiClient,
    }: SessionOptions) {
        super();

        this.userConfig = userConfig;
        this.keychain = keychain;
        this.logger = logger;
        this.apiClient = apiClient;
        this.atlasLocalClient = atlasLocalClient;
        this.exportsManager = exportsManager;
        this.connectionManager = connectionManager;
        this.connectionErrorHandler = connectionErrorHandler;
        this.connectionManager.events.on("connection-success", () => this.emit("connect"));
        this.connectionManager.events.on("connection-time-out", (error: ConnectionStateErroredLike) =>
            this.emit("connection-error", error)
        );
        this.connectionManager.events.on("connection-close", () => this.emit("disconnect"));
        this.connectionManager.events.on("connection-error", (error: ConnectionStateErroredLike) =>
            this.emit("connection-error", error)
        );
    }

    setMcpClient(mcpClient: Implementation | undefined): void {
        if (!mcpClient) {
            this.connectionManager.setClientName("unknown");
            this.logger.debug({
                id: LogId.serverMcpClientSet,
                context: "session",
                message: "MCP client info not found",
            });
        }

        this.mcpClient = {
            name: mcpClient?.name || "unknown",
            version: mcpClient?.version || "unknown",
            title: mcpClient?.title || "unknown",
        };

        // Set the client name on the connection manager for appName generation
        this.connectionManager.setClientName(this.mcpClient.name || "unknown");
    }

    async disconnect(): Promise<void> {
        const atlasCluster = this.connectedAtlasCluster;

        await this.connectionManager.close();

        if (atlasCluster?.username && atlasCluster?.projectId && this.apiClient) {
            void this.apiClient
                .deleteDatabaseUser({
                    params: {
                        path: {
                            groupId: atlasCluster.projectId,
                            username: atlasCluster.username,
                            databaseName: "admin",
                        },
                    },
                })
                .catch((err: unknown) => {
                    const error = err instanceof Error ? err : new Error(String(err));
                    this.logger.error({
                        id: LogId.atlasDeleteDatabaseUserFailure,
                        context: "session",
                        message: `Error deleting previous database user: ${error.message}`,
                    });
                });
        }
    }

    async close(): Promise<void> {
        await this.disconnect();
        await this.apiClient?.close();
        await this.exportsManager.close();
        this.emit("close");
    }

    async connectToConfiguredConnection(): Promise<void> {
        const connectionInfo = generateConnectionInfoFromCliArgs({
            ...(this.userConfig as Record<string, unknown>),
            connectionSpecifier: this.userConfig.connectionString,
        });
        await this.connectToMongoDB(connectionInfo as unknown as ConnectionSettingsLike);
    }

    async connectToMongoDB(settings: ConnectionSettingsLike): Promise<void> {
        await this.connectionManager.connect({ ...settings });
    }

    get isConnectedToMongoDB(): boolean {
        return this.connectionManager.currentConnectionState.tag === "connected";
    }

    async isSearchSupported(): Promise<boolean> {
        const state = this.connectionManager.currentConnectionState;
        if (state.tag === "connected" && typeof state.isSearchSupported === "function") {
            return await state.isSearchSupported();
        }

        return false;
    }

    async assertSearchSupported(): Promise<void> {
        const isSearchSupported = await this.isSearchSupported();
        if (!isSearchSupported) {
            throw new MongoDBError(
                ErrorCodes.AtlasSearchNotSupported,
                "Atlas Search is not supported in the current cluster."
            );
        }
    }

    get serviceProvider(): unknown {
        if (this.isConnectedToMongoDB) {
            const state = this.connectionManager.currentConnectionState;
            return state.serviceProvider;
        }

        throw new MongoDBError(ErrorCodes.NotConnectedToMongoDB, "Not connected to MongoDB");
    }

    get connectedAtlasCluster(): AtlasClusterConnectionInfoLike | undefined {
        return this.connectionManager.currentConnectionState.connectedAtlasCluster;
    }

    get connectionStringInfo(): ConnectionStringInfoLike | undefined {
        return this.connectionManager.currentConnectionState.connectionStringInfo;
    }
}
