import { ObjectId } from "bson";
import type { ApiClientCredentials } from "./atlas/apiClient.js";
import { ApiClient } from "./atlas/apiClient.js";
import type { Implementation } from "@modelcontextprotocol/sdk/types.js";
import type { CompositeLogger } from "./logger.js";
import { LogId } from "./logger.js";
import EventEmitter from "events";
import type {
    AtlasClusterConnectionInfo,
    ConnectionManager,
    ConnectionSettings,
    ConnectionStateConnected,
} from "./connectionManager.js";
import type { NodeDriverServiceProvider } from "@mongosh/service-provider-node-driver";
import { ErrorCodes, MongoDBError } from "./errors.js";
import type { ExportsManager } from "./exportsManager.js";

export interface SessionOptions {
    apiBaseUrl: string;
    apiClientId?: string;
    apiClientSecret?: string;
    logger: CompositeLogger;
    exportsManager: ExportsManager;
    connectionManager: ConnectionManager;
}

export type SessionEvents = {
    connect: [];
    close: [];
    disconnect: [];
    "connection-error": [string];
};

export class Session extends EventEmitter<SessionEvents> {
    readonly sessionId: string = new ObjectId().toString();
    readonly exportsManager: ExportsManager;
    readonly connectionManager: ConnectionManager;
    readonly apiClient: ApiClient;
    mcpClient?: {
        name?: string;
        version?: string;
        title?: string;
    };

    public logger: CompositeLogger;

    constructor({
        apiBaseUrl,
        apiClientId,
        apiClientSecret,
        logger,
        connectionManager,
        exportsManager,
    }: SessionOptions) {
        super();

        this.logger = logger;
        const credentials: ApiClientCredentials | undefined =
            apiClientId && apiClientSecret
                ? {
                      clientId: apiClientId,
                      clientSecret: apiClientSecret,
                  }
                : undefined;

        this.apiClient = new ApiClient({ baseUrl: apiBaseUrl, credentials }, logger);
        this.exportsManager = exportsManager;
        this.connectionManager = connectionManager;
        this.connectionManager.on("connection-succeeded", () => this.emit("connect"));
        this.connectionManager.on("connection-timed-out", (error) => this.emit("connection-error", error.errorReason));
        this.connectionManager.on("connection-closed", () => this.emit("disconnect"));
        this.connectionManager.on("connection-errored", (error) => this.emit("connection-error", error.errorReason));
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

        try {
            await this.connectionManager.disconnect();
        } catch (err: unknown) {
            const error = err instanceof Error ? err : new Error(String(err));
            this.logger.error({
                id: LogId.mongodbDisconnectFailure,
                context: "session",
                message: `Error closing service provider: ${error.message}`,
            });
        }

        if (atlasCluster?.username && atlasCluster?.projectId) {
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
        await this.apiClient.close();
        await this.exportsManager.close();
        this.emit("close");
    }

    async connectToMongoDB(settings: ConnectionSettings): Promise<void> {
        try {
            await this.connectionManager.connect({ ...settings });
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : (error as string);
            this.emit("connection-error", message);
            throw error;
        }
    }

    get isConnectedToMongoDB(): boolean {
        return this.connectionManager.currentConnectionState.tag === "connected";
    }

    get serviceProvider(): NodeDriverServiceProvider {
        if (this.isConnectedToMongoDB) {
            const state = this.connectionManager.currentConnectionState as ConnectionStateConnected;
            return state.serviceProvider;
        }

        throw new MongoDBError(ErrorCodes.NotConnectedToMongoDB, "Not connected to MongoDB");
    }

    get connectedAtlasCluster(): AtlasClusterConnectionInfo | undefined {
        return this.connectionManager.currentConnectionState.connectedAtlasCluster;
    }
}
