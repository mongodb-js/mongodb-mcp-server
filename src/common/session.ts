import { ApiClient, ApiClientCredentials } from "./atlas/apiClient.js";
import { Implementation } from "@modelcontextprotocol/sdk/types.js";
import logger, { LogId } from "./logger.js";
import EventEmitter from "events";
import {
    AnyConnectionState,
    ConnectionManager,
    ConnectionSettings,
    ConnectionStateConnected,
} from "./connectionManager.js";
import { NodeDriverServiceProvider } from "@mongosh/service-provider-node-driver";
import { ErrorCodes, MongoDBError } from "./errors.js";

export interface SessionOptions {
    apiBaseUrl: string;
    apiClientId?: string;
    apiClientSecret?: string;
    connectionManager?: ConnectionManager;
}

export type SessionEvents = {
    connect: [];
    close: [];
    disconnect: [];
    "connection-error": [string];
};

export class Session extends EventEmitter<SessionEvents> {
    sessionId?: string;
    connectionManager: ConnectionManager;
    apiClient: ApiClient;
    agentRunner?: {
        name: string;
        version: string;
    };
    connectedAtlasCluster?: {
        username: string;
        projectId: string;
        clusterName: string;
        expiryDate: Date;
    };

    constructor({ apiBaseUrl, apiClientId, apiClientSecret, connectionManager }: SessionOptions) {
        super();

        const credentials: ApiClientCredentials | undefined =
            apiClientId && apiClientSecret
                ? {
                      clientId: apiClientId,
                      clientSecret: apiClientSecret,
                  }
                : undefined;

        this.apiClient = new ApiClient({ baseUrl: apiBaseUrl, credentials });

        this.connectionManager = connectionManager ?? new ConnectionManager();
        this.connectionManager.on("connection-succeeded", () => this.emit("connect"));
        this.connectionManager.on("connection-timed-out", (error) => this.emit("connection-error", error.errorReason));
        this.connectionManager.on("connection-closed", () => this.emit("disconnect"));
        this.connectionManager.on("connection-errored", (error) => this.emit("connection-error", error.errorReason));
    }

    setAgentRunner(agentRunner: Implementation | undefined) {
        if (agentRunner?.name && agentRunner?.version) {
            this.agentRunner = {
                name: agentRunner.name,
                version: agentRunner.version,
            };
        }
    }

    async disconnect(): Promise<void> {
        try {
            await this.connectionManager.disconnect();
        } catch (err: unknown) {
            const error = err instanceof Error ? err : new Error(String(err));
            logger.error(LogId.mongodbDisconnectFailure, "Error closing service provider:", error.message);
        }

        if (this.connectedAtlasCluster?.username && this.connectedAtlasCluster?.projectId) {
            void this.apiClient
                .deleteDatabaseUser({
                    params: {
                        path: {
                            groupId: this.connectedAtlasCluster.projectId,
                            username: this.connectedAtlasCluster.username,
                            databaseName: "admin",
                        },
                    },
                })
                .catch((err: unknown) => {
                    const error = err instanceof Error ? err : new Error(String(err));
                    logger.error(
                        LogId.atlasDeleteDatabaseUserFailure,
                        "atlas-connect-cluster",
                        `Error deleting previous database user: ${error.message}`
                    );
                });
            this.connectedAtlasCluster = undefined;
        }
    }

    async close(): Promise<void> {
        await this.disconnect();
        await this.apiClient.close();
    }

    async connectToMongoDB(settings: ConnectionSettings): Promise<AnyConnectionState> {
        try {
            return await this.connectionManager.connect({ ...settings });
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : (error as string);
            this.emit("connection-error", message);
            throw error;
        }
    }

    isConnectedToMongoDB(): boolean {
        return this.connectionManager.currentConnectionState.tag === "connected";
    }

    get serviceProvider(): NodeDriverServiceProvider {
        if (this.isConnectedToMongoDB()) {
            const state = this.connectionManager.currentConnectionState as ConnectionStateConnected;
            return state.serviceProvider;
        }

        throw new MongoDBError(ErrorCodes.NotConnectedToMongoDB, "Not connected to MongoDB");
    }
}
