import { z } from "zod";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { AtlasToolBase } from "../atlasTool.js";
import { ToolArgs, OperationType } from "../../tool.js";
import { generateSecurePassword } from "../../../helpers/generatePassword.js";
import { LogId } from "../../../common/logger.js";
import { inspectCluster } from "../../../common/atlas/cluster.js";
import { ensureCurrentIpInAccessList } from "../../../common/atlas/accessListUtils.js";
import { AtlasClusterConnectionInfo } from "../../../common/connectionManager.js";

// Connection configuration constants
const USER_EXPIRY_MS = 1000 * 60 * 60 * 12; // 12 hours
const CONNECTION_RETRY_ATTEMPTS = 600; // 5 minutes (600 * 500ms = 5 minutes)
const CONNECTION_RETRY_DELAY_MS = 500; // 500ms between retries
const CONNECTION_CHECK_ATTEMPTS = 60; // 30 seconds (60 * 500ms = 30 seconds)
const CONNECTION_CHECK_DELAY_MS = 500; // 500ms between connection state checks

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export class ConnectClusterTool extends AtlasToolBase {
    public name = "atlas-connect-cluster";
    protected description = "Connect to MongoDB Atlas cluster";
    public operationType: OperationType = "connect";
    protected argsShape = {
        projectId: z.string().describe("Atlas project ID"),
        clusterName: z.string().describe("Atlas cluster name"),
    };

    private determineReadOnlyRole(): boolean {
        if (this.config.readOnly) return true;
        
        const disabledTools = this.config.disabledTools || [];
        const hasWriteAccess = !disabledTools.includes("create") && 
                              !disabledTools.includes("update") && 
                              !disabledTools.includes("delete");
        const hasReadAccess = !disabledTools.includes("read") && 
                             !disabledTools.includes("metadata");
        
        return !hasWriteAccess && hasReadAccess;
    }

    private isConnectedToOtherCluster(projectId: string, clusterName: string): boolean {
        return this.session.isConnectedToMongoDB && 
               (!this.session.connectedAtlasCluster ||
                this.session.connectedAtlasCluster.projectId !== projectId ||
                this.session.connectedAtlasCluster.clusterName !== clusterName);
    }

    private getConnectionState(): "connected" | "connecting" | "disconnected" | "errored" {
        const state = this.session.connectionManager.currentConnectionState;
        switch (state.tag) {
            case "connected": return "connected";
            case "connecting": return "connecting";
            case "disconnected": return "disconnected";
            case "errored": return "errored";
        }
    }

    private getErrorReason(): string | undefined {
        const state = this.session.connectionManager.currentConnectionState;
        return state.tag === "errored" ? state.errorReason : undefined;
    }

    private queryConnection(
        projectId: string,
        clusterName: string
    ): "connected" | "disconnected" | "connecting" | "connected-to-other-cluster" | "unknown" {
        if (!this.session.connectedAtlasCluster) {
            if (this.session.isConnectedToMongoDB) {
                return "connected-to-other-cluster";
            }
            return "disconnected";
        }

        if (this.isConnectedToOtherCluster(projectId, clusterName)) {
            return "connected-to-other-cluster";
        }

        const connectionState = this.getConnectionState();
        switch (connectionState) {
            case "connecting":
            case "disconnected": // we might still be calling Atlas APIs and not attempted yet to connect to MongoDB, but we are still "connecting"
                return "connecting";
            case "connected":
                return "connected";
            case "errored":
                const errorReason = this.getErrorReason();
                this.session.logger.debug({
                    id: LogId.atlasConnectFailure,
                    context: "atlas-connect-cluster",
                    message: `error querying cluster: ${errorReason || "unknown error"}`,
                });
                return "unknown";
        }
    }

    private async createDatabaseUser(
        projectId: string,
        clusterName: string,
        readOnly: boolean
    ): Promise<{
        username: string;
        password: string;
        expiryDate: Date;
    }> {
        const username = `mcpUser${Math.floor(Math.random() * 100000)}`;
        const password = await generateSecurePassword();
        const expiryDate = new Date(Date.now() + USER_EXPIRY_MS);

        const roleName = readOnly ? "readAnyDatabase" : "readWriteAnyDatabase";

        await this.session.apiClient.createDatabaseUser({
            params: {
                path: {
                    groupId: projectId,
                },
            },
            body: {
                databaseName: "admin",
                groupId: projectId,
                roles: [
                    {
                        roleName,
                        databaseName: "admin",
                    },
                ],
                scopes: [{ type: "CLUSTER", name: clusterName }],
                username,
                password,
                awsIAMType: "NONE",
                ldapAuthType: "NONE",
                oidcAuthType: "NONE",
                x509Type: "NONE",
                deleteAfterDate: expiryDate.toISOString(),
            },
        });

        return { username, password, expiryDate };
    }

    private buildConnectionString(
        clusterConnectionString: string,
        username: string,
        password: string
    ): string {
        const cn = new URL(clusterConnectionString);
        cn.username = username;
        cn.password = password;
        cn.searchParams.set("authSource", "admin");
        return cn.toString();
    }

    private async prepareClusterConnection(
        projectId: string,
        clusterName: string
    ): Promise<{ connectionString: string; atlas: AtlasClusterConnectionInfo }> {
        const cluster = await inspectCluster(this.session.apiClient, projectId, clusterName);

        if (!cluster.connectionString) {
            throw new Error("Connection string not available");
        }

        const readOnly = this.determineReadOnlyRole();
        const { username, password, expiryDate } = await this.createDatabaseUser(
            projectId,
            clusterName,
            readOnly
        );

        const connectedAtlasCluster = {
            username,
            projectId,
            clusterName,
            expiryDate,
        };

        const connectionString = this.buildConnectionString(
            cluster.connectionString,
            username,
            password
        );

        return { connectionString, atlas: connectedAtlasCluster };
    }

    private async connectToCluster(connectionString: string, atlas: AtlasClusterConnectionInfo): Promise<void> {
        let lastError: Error | undefined = undefined;

        this.session.logger.debug({
            id: LogId.atlasConnectAttempt,
            context: "atlas-connect-cluster",
            message: `attempting to connect to cluster: ${this.session.connectedAtlasCluster?.clusterName}`,
            noRedaction: true,
        });

        // try to connect for about 5 minutes
        for (let i = 0; i < CONNECTION_RETRY_ATTEMPTS; i++) {
            try {
                lastError = undefined;

                await this.session.connectToMongoDB({ connectionString, atlas });
                break;
            } catch (err: unknown) {
                const error = err instanceof Error ? err : new Error(String(err));

                lastError = error;

                this.session.logger.debug({
                    id: LogId.atlasConnectFailure,
                    context: "atlas-connect-cluster",
                    message: `error connecting to cluster: ${error.message}`,
                });

                await sleep(CONNECTION_RETRY_DELAY_MS); // wait for 500ms before retrying
            }

            if (
                !this.session.connectedAtlasCluster ||
                this.session.connectedAtlasCluster.projectId !== atlas.projectId ||
                this.session.connectedAtlasCluster.clusterName !== atlas.clusterName
            ) {
                throw new Error("Cluster connection aborted");
            }
        }

        if (lastError) {
            await this.cleanupDatabaseUserOnFailure(atlas);
            throw lastError;
        }

        this.session.logger.debug({
            id: LogId.atlasConnectSucceeded,
            context: "atlas-connect-cluster",
            message: `connected to cluster: ${this.session.connectedAtlasCluster?.clusterName}`,
            noRedaction: true,
        });
    }

    private async cleanupDatabaseUserOnFailure(atlas: AtlasClusterConnectionInfo): Promise<void> {
        const currentCluster = this.session.connectedAtlasCluster;
        if (currentCluster?.projectId === atlas.projectId &&
            currentCluster?.clusterName === atlas.clusterName &&
            currentCluster?.username) {
            try {
                await this.session.apiClient.deleteDatabaseUser({
                    params: {
                        path: {
                            groupId: currentCluster.projectId,
                            username: currentCluster.username,
                            databaseName: "admin",
                        },
                    },
                });
            } catch (err: unknown) {
                const error = err instanceof Error ? err : new Error(String(err));
                this.session.logger.debug({
                    id: LogId.atlasConnectFailure,
                    context: "atlas-connect-cluster",
                    message: `error deleting database user: ${error.message}`,
                });
            }
        }
    }

    protected async execute({ projectId, clusterName }: ToolArgs<typeof this.argsShape>): Promise<CallToolResult> {
        await ensureCurrentIpInAccessList(this.session.apiClient, projectId);
        for (let i = 0; i < CONNECTION_CHECK_ATTEMPTS; i++) {
            const state = this.queryConnection(projectId, clusterName);
            switch (state) {
                case "connected": {
                    return {
                        content: [
                            {
                                type: "text",
                                text: `Connected to cluster "${clusterName}".`,
                            },
                        ],
                    };
                }
                case "connecting":
                case "unknown": {
                    break;
                }
                case "connected-to-other-cluster":
                case "disconnected":
                default: {
                    await this.session.disconnect();
                    const { connectionString, atlas } = await this.prepareClusterConnection(projectId, clusterName);

                    // try to connect for about 5 minutes asynchronously
                    try {
                        await this.connectToCluster(connectionString, atlas);
                    } catch (err: unknown) {
                        const error = err instanceof Error ? err : new Error(String(err));
                        this.session.logger.error({
                            id: LogId.atlasConnectFailure,
                            context: "atlas-connect-cluster",
                            message: `error connecting to cluster: ${error.message}`,
                        });
                    }
                    break;
                }
            }

            await sleep(CONNECTION_CHECK_DELAY_MS);
        }

        return {
            content: [
                {
                    type: "text" as const,
                    text: `Attempting to connect to cluster "${clusterName}"...`,
                },
                {
                    type: "text" as const,
                    text: `Warning: Provisioning a user and connecting to the cluster may take more time, please check again in a few seconds.`,
                },
                {
                    type: "text" as const,
                    text: `Warning: Make sure your IP address was enabled in the allow list setting of the Atlas cluster.`,
                },
            ],
        };
    }
}
