import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { type OperationType, type ToolArgs } from "../../tool.js";
import { AtlasToolBase } from "../atlasTool.js";
import { generateSecurePassword } from "../../../helpers/generatePassword.js";
import { LogId } from "../../../common/logging/index.js";
import { getConnectionString, inspectCluster } from "../../../common/atlas/cluster.js";
import { ensureCurrentIpInAccessList } from "../../../common/atlas/accessListUtils.js";
import type { AtlasClusterConnectionInfo } from "../../../common/connectionManager.js";
import { getDefaultRoleFromConfig } from "../../../common/atlas/roles.js";
import { AtlasArgs } from "../../args.js";
import type { ConnectionMetadata } from "../../../telemetry/types.js";
import { ConnectionString } from "mongodb-connection-string-url";
import semver from "semver";
import { oidcDeviceFlowContent } from "../../../common/connectionErrorHandler.js";

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
    connectionType: AtlasArgs.connectionType().describe(
        "Type of connection (standard, private, or privateEndpoint) to an Atlas cluster"
    ),
    authMechanism: z
        .literal("username-password")
        .optional()
        .describe(
            "Override to force temporary user creation for this connection. " +
                "Only set this if: the server is configured for 'mongodb-oidc' AND a previous " +
                "OIDC-authenticated connection to this cluster produced authorization errors on " +
                "database operations, indicating the OIDC identity lacks sufficient access. " +
                "Requires Atlas API credentials with database user management permissions. " +
                "Do not set this preemptively."
        ),
};

export class ConnectClusterTool extends AtlasToolBase {
    static toolName = "atlas-connect-cluster";
    public description = "Connect to MongoDB Atlas cluster";
    static operationType: OperationType = "connect";
    public argsShape = ConnectClusterArgs;

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
        clusterName: string,
        connectionType: "standard" | "private" | "privateEndpoint" | undefined = "standard"
    ): Promise<{ connectionString: string; atlas: AtlasClusterConnectionInfo }> {
        const cluster = await inspectCluster(this.apiClient, projectId, clusterName);

        if (cluster.connectionStrings === undefined) {
            throw new Error("Connection strings not available");
        }
        const connectionString = getConnectionString(cluster.connectionStrings, connectionType);
        if (connectionString === undefined) {
            throw new Error(
                `Connection string for connection type "${connectionType}" is not available. Please ensure this connection type is set up in Atlas. See https://www.mongodb.com/docs/atlas/connect-to-database-deployment/#connect-to-an-atlas-cluster.`
            );
        }

        const username = `mcpUser${Math.floor(Math.random() * 100000)}`;
        const password = await generateSecurePassword();

        const expiryDate = new Date(Date.now() + this.config.atlasTemporaryDatabaseUserLifetimeMs);
        const role = getDefaultRoleFromConfig(this.config);

        await this.apiClient.createDatabaseUser({
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
            authType: "temp-user" as const,
            username,
            projectId,
            clusterName,
            instanceType: cluster.instanceType,
            provider: cluster.provider,
            region: cluster.region,
            expiryDate,
        };

        const cn = new URL(connectionString);
        cn.username = username;
        cn.password = password;
        cn.searchParams.set("authSource", "admin");

        this.session.keychain.register(username, "user");
        this.session.keychain.register(password, "password");

        return { connectionString: cn.toString(), atlas: connectedAtlasCluster };
    }

    private async prepareClusterConnectionOIDC(
        projectId: string,
        clusterName: string,
        connectionType: "standard" | "private" | "privateEndpoint" | undefined = "standard"
    ): Promise<{ connectionString: string; atlas: AtlasClusterConnectionInfo } | null> {
        const cluster = await inspectCluster(this.apiClient, projectId, clusterName);

        if (cluster.connectionStrings === undefined) {
            throw new Error("Connection strings not available");
        }
        const connectionString = getConnectionString(cluster.connectionStrings, connectionType);
        if (connectionString === undefined) {
            throw new Error(
                `Connection string for connection type "${connectionType}" is not available. Please ensure this connection type is set up in Atlas. See https://www.mongodb.com/docs/atlas/connect-to-database-deployment/#connect-to-an-atlas-cluster.`
            );
        }

        if (cluster.mongoDBVersion) {
            const coerced = semver.coerce(cluster.mongoDBVersion);
            if (coerced && semver.lt(coerced, "7.0.0")) {
                return null;
            }
        }

        const cn = new ConnectionString(connectionString);
        cn.searchParams.set("authMechanism", "MONGODB-OIDC");
        if (this.config.atlasOidcMechanismProperties) {
            cn.searchParams.set("authMechanismProperties", this.config.atlasOidcMechanismProperties);
        }

        const atlas: AtlasClusterConnectionInfo = {
            authType: "oidc",
            projectId,
            clusterName,
            instanceType: cluster.instanceType,
            provider: cluster.provider,
            region: cluster.region,
        };

        return { connectionString: cn.toString(), atlas };
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
            const connectedCluster = this.session.connectedAtlasCluster;
            if (
                connectedCluster?.projectId === atlas.projectId &&
                connectedCluster?.clusterName === atlas.clusterName &&
                connectedCluster?.authType === "temp-user"
            ) {
                void this.apiClient
                    .deleteDatabaseUser({
                        params: {
                            path: {
                                groupId: connectedCluster.projectId,
                                username: connectedCluster.username,
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

    protected async execute({
        projectId,
        clusterName,
        connectionType,
        authMechanism,
    }: ToolArgs<typeof this.argsShape>): Promise<CallToolResult> {
        const ipAccessListUpdated = await ensureCurrentIpInAccessList(this.apiClient, projectId);
        let createdUser = false;
        let oidcFallbackMessage: string | undefined;

        const state = this.queryConnection(projectId, clusterName);
        switch (state) {
            case "connected-to-other-cluster":
            case "disconnected": {
                await this.session.disconnect();

                if (this.config.atlasAuthMechanism === "mongodb-oidc" && authMechanism !== "username-password") {
                    const oidcResult = await this.prepareClusterConnectionOIDC(
                        projectId,
                        clusterName,
                        connectionType
                    );

                    if (oidcResult !== null) {
                        void this.session
                            .connectToMongoDB(oidcResult)
                            .catch((err: unknown) => {
                                const error = err instanceof Error ? err : new Error(String(err));
                                this.session.logger.error({
                                    id: LogId.atlasConnectFailure,
                                    context: "atlas-connect-cluster",
                                    message: `error connecting to cluster via OIDC: ${error.message}`,
                                });
                            });
                        break;
                    }

                    oidcFallbackMessage =
                        `Note: OIDC authentication is not supported on this cluster's MongoDB version. ` +
                        `Falling back to temporary user creation.`;
                }

                const { connectionString, atlas } = await this.prepareClusterConnection(
                    projectId,
                    clusterName,
                    connectionType
                );

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
            case "connecting":
            case "connected":
            case "unknown":
            default: {
                break;
            }
        }

        for (let i = 0; i < 60; i++) {
            const connState = this.session.connectionManager.currentConnectionState;

            // Surface OIDC device-flow info so the user can complete authentication.
            if (
                connState.tag === "connecting" &&
                connState.connectedAtlasCluster?.projectId === projectId &&
                connState.connectedAtlasCluster?.clusterName === clusterName &&
                connState.oidcLoginUrl
            ) {
                return {
                    content: [oidcDeviceFlowContent(connState.oidcLoginUrl, connState.oidcUserCode)],
                };
            }

            const queryState = this.queryConnection(projectId, clusterName);
            switch (queryState) {
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

                    if (oidcFallbackMessage) {
                        content.push({
                            type: "text",
                            text: oidcFallbackMessage,
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
                case "unknown":
                case "connected-to-other-cluster":
                case "disconnected":
                default: {
                    break;
                }
            }

            await sleep(500); // wait 500ms before checking the connection state again
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

        if (oidcFallbackMessage) {
            content.push({
                type: "text" as const,
                text: oidcFallbackMessage,
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

    protected override resolveTelemetryMetadata(
        args: ToolArgs<typeof this.argsShape>,
        { result }: { result: CallToolResult }
    ): ConnectionMetadata {
        const parentMetadata = super.resolveTelemetryMetadata(args, { result });
        const connectionMetadata = this.getConnectionInfoMetadata();
        if (connectionMetadata && connectionMetadata.project_id !== undefined) {
            // delete the project_id from the parent metadata to avoid duplication
            delete parentMetadata.project_id;
        }
        return { ...parentMetadata, ...connectionMetadata };
    }
}
