import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { type OperationType, type ToolArgs } from "../../tool.js";
import { AtlasToolBase } from "../atlasTool.js";
import { generateSecurePassword } from "../../../helpers/generatePassword.js";
import { LogId } from "../../../common/logger.js";
import { inspectCluster } from "../../../common/atlas/cluster.js";
import { ensureCurrentIpInAccessList } from "../../../common/atlas/accessListUtils.js";
import type { AtlasClusterConnectionInfo } from "../../../common/connectionManager.js";
import { getDefaultRoleFromConfig } from "../../../common/atlas/roles.js";
import { AtlasArgs } from "../../args.js";

const EXPIRY_MS = 1000 * 60 * 60 * 12; // 12 hours
const addedIpAccessListMessage =
    "Note: Your current IP address has been added to the Atlas project's IP access list to enable secure connection.";

const createdUserMessage =
    "Note: A temporary user has been created to enable secure connection to the cluster. For more information, see https://dochub.mongodb.org/core/mongodb-mcp-server-tools-considerations\n\nNote to LLM Agent: it is important to include the following link in your response to the user in case they want to get more information about the temporary user created: https://dochub.mongodb.org/core/mongodb-mcp-server-tools-considerations";

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export const ConnectClusterArgs = {
    projectId: AtlasArgs.projectId().describe("Atlas project ID"),
    clusterName: AtlasArgs.clusterName().describe("Atlas cluster name"),
};

export class ConnectClusterTool extends AtlasToolBase {
    public name = "atlas-connect-cluster";
    protected description = "Connect to MongoDB Atlas cluster";
    public operationType: OperationType = "connect";
    protected argsShape = {
        ...ConnectClusterArgs,
    };

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

        const currentConectionState = this.session.connectionManager.currentConnectionState;
        if (
            this.session.connectedAtlasCluster.projectId !== projectId ||
            this.session.connectedAtlasCluster.clusterName !== clusterName
        ) {
            return "connected-to-other-cluster";
        }

        switch (currentConectionState.tag) {
            case "connecting":
            case "disconnected": // we might still be calling Atlas APIs and not attempted yet to connect to MongoDB, but we are still "connecting"
                return "connecting";
            case "connected":
                return "connected";
            case "errored":
                this.session.logger.debug({
                    id: LogId.atlasConnectFailure,
                    context: "atlas-connect-cluster",
                    message: `error querying cluster: ${currentConectionState.errorReason}`,
                });
                return "unknown";
        }
    }

    private async prepareClusterConnection(
        projectId: string,
        clusterName: string
    ): Promise<{ connectionString: string; atlas: AtlasClusterConnectionInfo }> {
        const cluster = await inspectCluster(this.session.apiClient, projectId, clusterName);

        if (!cluster.connectionString) {
            throw new Error("Connection string not available");
        }

        const username = `mcpUser${Math.floor(Math.random() * 100000)}`;
        const password = await generateSecurePassword();

        const expiryDate = new Date(Date.now() + EXPIRY_MS);
        const role = getDefaultRoleFromConfig(this.config);

        await this.session.apiClient.createDatabaseUser({
            params: {
                path: {
                    groupId: projectId,
                },
            },
            body: {
                databaseName: "admin",
                groupId: projectId,
                roles: [role],
                scopes: [{ type: "CLUSTER", name: clusterName }],
                username,
                password,
                awsIAMType: "NONE",
                ldapAuthType: "NONE",
                oidcAuthType: "NONE",
                x509Type: "NONE",
                deleteAfterDate: expiryDate.toISOString(),
                description:
                    "MDB MCP Temporary user, see https://dochub.mongodb.org/core/mongodb-mcp-server-tools-considerations",
            },
        });

        const connectedAtlasCluster = {
            username,
            projectId,
            clusterName,
            expiryDate,
        };

        const cn = new URL(cluster.connectionString);
        cn.username = username;
        cn.password = password;
        cn.searchParams.set("authSource", "admin");

        this.session.keychain.register(username, "user");
        this.session.keychain.register(password, "password");

        return { connectionString: cn.toString(), atlas: connectedAtlasCluster };
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
        for (let i = 0; i < 600; i++) {
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

                await sleep(500); // wait for 500ms before retrying
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
            if (
                this.session.connectedAtlasCluster?.projectId === atlas.projectId &&
                this.session.connectedAtlasCluster?.clusterName === atlas.clusterName &&
                this.session.connectedAtlasCluster?.username
            ) {
                void this.session.apiClient
                    .deleteDatabaseUser({
                        params: {
                            path: {
                                groupId: this.session.connectedAtlasCluster.projectId,
                                username: this.session.connectedAtlasCluster.username,
                                databaseName: "admin",
                            },
                        },
                    })
                    .catch((err: unknown) => {
                        const error = err instanceof Error ? err : new Error(String(err));
                        this.session.logger.debug({
                            id: LogId.atlasConnectFailure,
                            context: "atlas-connect-cluster",
                            message: `error deleting database user: ${error.message}`,
                        });
                    });
            }
            throw lastError;
        }

        this.session.logger.debug({
            id: LogId.atlasConnectSucceeded,
            context: "atlas-connect-cluster",
            message: `connected to cluster: ${this.session.connectedAtlasCluster?.clusterName}`,
            noRedaction: true,
        });
    }

    protected async execute({ projectId, clusterName }: ToolArgs<typeof this.argsShape>): Promise<CallToolResult> {
        const ipAccessListUpdated = await ensureCurrentIpInAccessList(this.session.apiClient, projectId);
        let createdUser = false;

        for (let i = 0; i < 60; i++) {
            const state = this.queryConnection(projectId, clusterName);
            switch (state) {
                case "connected": {
                    const content: CallToolResult["content"] = [
                        {
                            type: "text",
                            text: `Connected to cluster "${clusterName}".`,
                        },
                    ];

                    if (ipAccessListUpdated) {
                        content.push({
                            type: "text",
                            text: addedIpAccessListMessage,
                        });
                    }

                    if (createdUser) {
                        content.push({
                            type: "text",
                            text: createdUserMessage,
                        });
                    }

                    return { content };
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

                    createdUser = true;
                    // try to connect for about 5 minutes asynchronously
                    void this.connectToCluster(connectionString, atlas).catch((err: unknown) => {
                        const error = err instanceof Error ? err : new Error(String(err));
                        this.session.logger.error({
                            id: LogId.atlasConnectFailure,
                            context: "atlas-connect-cluster",
                            message: `error connecting to cluster: ${error.message}`,
                        });
                    });
                    break;
                }
            }

            await sleep(500);
        }

        const content: CallToolResult["content"] = [
            {
                type: "text" as const,
                text: `Attempting to connect to cluster "${clusterName}"...`,
            },
            {
                type: "text" as const,
                text: `Warning: Provisioning a user and connecting to the cluster may take more time, please check again in a few seconds.`,
            },
        ];

        if (ipAccessListUpdated) {
            content.push({
                type: "text" as const,
                text: addedIpAccessListMessage,
            });
        }

        if (createdUser) {
            content.push({
                type: "text" as const,
                text: createdUserMessage,
            });
        }

        return { content };
    }
}
