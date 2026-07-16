import { z } from "zod";
import { type ToolArgs, type ToolResult, LogId, requestIdAttr, sleep } from "@mongodb-js/mcp-core";
import type {
    OperationType,
    ConnectionMetadata,
    AtlasClusterConnectionInfo,
    SharedTierTier,
    SharedTierMetricName,
    ToolExecutionContext,
} from "@mongodb-js/mcp-types";
import { SHARED_TIER_METRIC_NAMES } from "@mongodb-js/mcp-types";
import { AtlasToolBase } from "../../atlasTool.js";
import { generateSecurePassword } from "../../helpers/generatePassword.js";
import { getConnectionString, inspectCluster } from "../../helpers/cluster.js";
import { ensureCurrentIpInAccessList } from "../../helpers/accessListUtils.js";
import { getDefaultRoleFromConfig } from "../../helpers/roles.js";
import { runSharedTierAlertsHook } from "../../helpers/sharedTierAlertsHook.js";
import { AtlasArgs } from "../../args.js";

const addedIpAccessListMessage =
    "Note: Your current IP address has been added to the Atlas project's IP access list to enable secure connection.";

const createdUserMessage =
    "Note: A temporary user has been created to enable secure connection to the cluster. For more information, see https://dochub.mongodb.org/core/mongodb-mcp-server-tools-considerations\n\nNote to LLM Agent: it is important to include the following link in your response to the user in case they want to get more information about the temporary user created: https://dochub.mongodb.org/core/mongodb-mcp-server-tools-considerations";

export const ConnectClusterArgs = {
    projectId: AtlasArgs.projectId().describe("Atlas project ID"),
    clusterName: AtlasArgs.clusterName().describe("Atlas cluster name"),
    connectionType: AtlasArgs.connectionType().describe(
        "Type of connection (standard, private, or privateEndpoint) to an Atlas cluster"
    ),
};

const ConnectClusterOutputSchema = {
    state: z.enum(["connected", "connecting"]),
    addedCurrentIp: z.boolean(),
    createdTemporaryUser: z.boolean(),
    temporaryUserClarification: z.string().optional(),
    sharedTierAlertsDetected: z.boolean().optional(),
    sharedTierTier: z.enum(["Free", "Flex"]).optional(),
    sharedTierAlerts: z.enum(SHARED_TIER_METRIC_NAMES).array().optional(),
};

export type ConnectClusterOutput = z.infer<z.ZodObject<typeof ConnectClusterOutputSchema>>;

export class ConnectClusterTool extends AtlasToolBase {
    static toolName = "atlas-connect-cluster";
    public description = "Connect to MongoDB Atlas cluster";
    static operationType: OperationType = "connect";
    public argsShape = ConnectClusterArgs;
    public override outputSchema = ConnectClusterOutputSchema;

    private queryConnection(
        projectId: string,
        clusterName: string
    ): "connected" | "disconnected" | "connecting" | "connected-to-other-cluster" | "unknown" {
        const session = this.session;
        if (!session.connectedAtlasCluster) {
            if (session.isConnectedToMongoDB) {
                return "connected-to-other-cluster";
            }
            return "disconnected";
        }

        // Access the connection manager through session
        const currentConectionState = session.connectionManager?.currentConnectionState;
        if (
            session.connectedAtlasCluster.projectId !== projectId ||
            session.connectedAtlasCluster.clusterName !== clusterName
        ) {
            return "connected-to-other-cluster";
        }

        switch (currentConectionState?.tag) {
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
            default:
                return "unknown";
        }
    }

    private async prepareClusterConnection(
        projectId: string,
        clusterName: string,
        connectionType: "standard" | "private" | "privateEndpoint" | undefined = "standard",
        context: ToolExecutionContext
    ): Promise<{ connectionString: string; atlas: AtlasClusterConnectionInfo }> {
        const cluster = await inspectCluster(this.apiClient, projectId, clusterName, context);

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

        const expiryDate = new Date(Date.now() + (this.config.atlasTemporaryDatabaseUserLifetimeMs ?? 3600000));
        const role = getDefaultRoleFromConfig(this.config);

        await this.apiClient.createDatabaseUser(
            {
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
            },
            context
        );

        const connectedAtlasCluster: AtlasClusterConnectionInfo = {
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

    private async connectToCluster(
        connectionString: string,
        atlas: AtlasClusterConnectionInfo,
        context: ToolExecutionContext
    ): Promise<void> {
        let lastError: Error | undefined = undefined;

        this.session.logger.debug({
            id: LogId.atlasConnectAttempt,
            context: "atlas-connect-cluster",
            message: `attempting to connect to cluster: ${this.session.connectedAtlasCluster?.clusterName}`,
            noRedaction: true,
            attributes: { ...requestIdAttr(context.requestInfo?.headers) },
        });

        // try to connect for about 5 minutes
        for (let i = 0; i < 600; i++) {
            try {
                lastError = undefined;

                // Connect to MongoDB via the session
                await this.session.connectToMongoDB({ connectionString, atlas });
                break;
            } catch (err: unknown) {
                const error = err instanceof Error ? err : new Error(String(err));

                lastError = error;

                this.session.logger.debug({
                    id: LogId.atlasConnectFailure,
                    context: "atlas-connect-cluster",
                    message: `error connecting to cluster: ${error.message}`,
                    attributes: { ...requestIdAttr(context.requestInfo?.headers) },
                });

                await sleep(500); // wait for 500ms before retrying
            }

            const session = this.session;
            if (
                !session.connectedAtlasCluster ||
                session.connectedAtlasCluster.projectId !== atlas.projectId ||
                session.connectedAtlasCluster.clusterName !== atlas.clusterName
            ) {
                throw new Error("Cluster connection aborted");
            }
        }

        if (lastError) {
            const session = this.session;
            if (
                session.connectedAtlasCluster?.projectId === atlas.projectId &&
                session.connectedAtlasCluster?.clusterName === atlas.clusterName &&
                session.connectedAtlasCluster?.username
            ) {
                const username = session.connectedAtlasCluster.username;
                const connectedProjectId = session.connectedAtlasCluster.projectId;
                void this.apiClient
                    .deleteDatabaseUser(
                        {
                            params: {
                                path: {
                                    groupId: connectedProjectId,
                                    username,
                                    databaseName: "admin",
                                },
                            },
                        },
                        context
                    )
                    .catch((err: unknown) => {
                        const error = err instanceof Error ? err : new Error(String(err));
                        this.session.logger.debug({
                            id: LogId.atlasConnectFailure,
                            context: "atlas-connect-cluster",
                            message: `error deleting database user: ${error.message}`,
                            attributes: { ...requestIdAttr(context.requestInfo?.headers) },
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
            attributes: { ...requestIdAttr(context.requestInfo?.headers) },
        });
    }

    protected async execute(
        { projectId, clusterName, connectionType }: ToolArgs<typeof this.argsShape>,
        context: ToolExecutionContext
    ): Promise<ToolResult<typeof this.outputSchema>> {
        const ipAccessListUpdated = await ensureCurrentIpInAccessList(this.apiClient, projectId);
        let createdUser = false;

        const state = this.queryConnection(projectId, clusterName);
        switch (state) {
            case "connected-to-other-cluster":
            case "disconnected": {
                await this.session.disconnect();

                const preparedConnection = await this.prepareClusterConnection(
                    projectId,
                    clusterName,
                    connectionType,
                    context
                );

                createdUser = true;

                // try to connect for about 5 minutes asynchronously
                void this.connectToCluster(
                    preparedConnection.connectionString,
                    preparedConnection.atlas,
                    context
                ).catch((err: unknown) => {
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
            const state = this.queryConnection(projectId, clusterName);
            switch (state) {
                case "connected": {
                    const content: ToolResult<typeof ConnectClusterOutputSchema>["content"] = [
                        {
                            type: "text" as const,
                            text: `Connected to cluster "${clusterName}".`,
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

                    const baseStructuredContent = {
                        state: "connected" as const,
                        addedCurrentIp: ipAccessListUpdated,
                        createdTemporaryUser: createdUser,
                        ...(createdUser && { temporaryUserClarification: createdUserMessage }),
                    };

                    const sharedTierFields = await this.runSharedTierHook(
                        this.session.connectedAtlasCluster,
                        content,
                        context
                    );
                    return { content, structuredContent: { ...baseStructuredContent, ...sharedTierFields } };
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

        const content: ToolResult<typeof ConnectClusterOutputSchema>["content"] = [
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

        const sharedTierFields = await this.runSharedTierHook(this.session.connectedAtlasCluster, content, context);
        return {
            content,
            structuredContent: {
                state: "connecting",
                addedCurrentIp: ipAccessListUpdated,
                createdTemporaryUser: createdUser,
                ...(createdUser && { temporaryUserClarification: createdUserMessage }),
                ...sharedTierFields,
            },
        };
    }

    private async runSharedTierHook(
        atlas: AtlasClusterConnectionInfo | undefined,
        content: ToolResult<typeof ConnectClusterOutputSchema>["content"],
        context: ToolExecutionContext
    ): Promise<{
        sharedTierAlertsDetected?: boolean;
        sharedTierTier?: SharedTierTier;
        sharedTierAlerts?: SharedTierMetricName[];
    }> {
        let tier: SharedTierTier;
        switch (atlas?.instanceType) {
            case "FREE":
                tier = "Free";
                break;
            case "FLEX":
                tier = "Flex";
                break;
            default:
                return {};
        }
        const hookResult = await runSharedTierAlertsHook({
            projectId: atlas.projectId,
            clusterName: atlas.clusterName,
            instanceType: atlas.instanceType,
            apiClient: this.apiClient,
            logger: this.session.logger,
            context,
        });
        if (hookResult !== undefined) {
            content.push({ type: "text", text: hookResult.recommendationText });
            return {
                sharedTierAlertsDetected: true,
                sharedTierTier: hookResult.tier,
                sharedTierAlerts: hookResult.alertTypes,
            };
        }
        return { sharedTierAlertsDetected: false, sharedTierTier: tier };
    }

    protected override resolveTelemetryMetadata(
        args: ToolArgs<typeof this.argsShape>,
        { result }: { result: ToolResult<typeof ConnectClusterOutputSchema> }
    ): ConnectionMetadata {
        const parentMetadata = super.resolveTelemetryMetadata(args, { result });
        const connectionMetadata = this.getConnectionInfoMetadata();
        if (connectionMetadata && connectionMetadata.project_id !== undefined) {
            // delete the project_id from the parent metadata to avoid duplication
            delete parentMetadata.project_id;
        }
        return {
            ...parentMetadata,
            ...connectionMetadata,
            ...(result.structuredContent?.sharedTierTier !== undefined && {
                // TelemetryBoolSet type required
                shared_tier_alerts_detected: result.structuredContent.sharedTierAlertsDetected ? "true" : "false",
                shared_tier_tier: result.structuredContent.sharedTierTier,
                shared_tier_alerts: result.structuredContent.sharedTierAlerts,
            }),
        };
    }
}
