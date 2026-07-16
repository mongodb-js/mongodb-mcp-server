import { type OperationType, type ToolArgs, type ToolResult, type ToolExecutionContext } from "../../tool.js";
import { requestIdAttr } from "../../../helpers/requestIdAttr.js";
import { z } from "zod";
import { AtlasToolBase } from "../atlasTool.js";
import { generateSecurePassword } from "../../../helpers/generatePassword.js";
import { LogId } from "../../../common/logging/index.js";
import { getConnectionString, inspectCluster } from "../../../common/atlas/cluster.js";
import { ensureCurrentIpInAccessList, ACCESS_LIST_ADDED_NOTE } from "../../../common/atlas/accessListUtils.js";
import { runSharedTierAlertsHook } from "../../../common/atlas/sharedTierAlertsHook.js";
import type { AtlasClusterConnectionInfo } from "../../../common/connectionManager.js";
import { atlasClusterSlug, type ConnectionEntry } from "../../../common/connectionRegistry.js";
import { getDefaultRoleFromConfig } from "../../../common/atlas/roles.js";
import { AtlasArgs } from "../../args.js";
import { SHARED_TIER_METRIC_NAMES } from "../../../telemetry/types.js";
import type { ConnectionMetadata, SharedTierTier, SharedTierMetricName } from "../../../telemetry/types.js";
import { sleep } from "../../../common/managedTimeout.js";

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
    connectionId: z.string(),
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
    public description =
        "Connect to MongoDB Atlas cluster and get back a connectionId to pass to the other MongoDB tools. Each call establishes a new, independent connection — multiple connections can be active at the same time.";
    static operationType: OperationType = "connect";
    public argsShape = ConnectClusterArgs;
    public override outputSchema = ConnectClusterOutputSchema;

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

        const expiryDate = new Date(Date.now() + this.config.atlasTemporaryDatabaseUserLifetimeMs);
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

    private async deleteTemporaryUser(
        atlas: AtlasClusterConnectionInfo,
        context?: ToolExecutionContext
    ): Promise<void> {
        if (!atlas.username) {
            return;
        }
        await this.apiClient
            .deleteDatabaseUser(
                {
                    params: {
                        path: {
                            groupId: atlas.projectId,
                            username: atlas.username,
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
                });
            });
    }

    private async connectToCluster(
        entry: ConnectionEntry,
        connectionString: string,
        atlas: AtlasClusterConnectionInfo,
        context: ToolExecutionContext
    ): Promise<void> {
        let lastError: Error | undefined = undefined;

        this.session.logger.debug({
            id: LogId.atlasConnectAttempt,
            context: "atlas-connect-cluster",
            message: `attempting to connect to cluster: ${atlas.clusterName}`,
            noRedaction: true,
            attributes: { ...requestIdAttr(context.requestInfo?.headers) },
        });

        // try to connect for about 5 minutes
        for (let i = 0; i < 600; i++) {
            try {
                lastError = undefined;

                await entry.connect({ connectionString, atlas });
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

            if ((await this.session.connectionRegistry.peek(entry.connectionId)) !== entry) {
                // The entry was revoked (disconnect tool, LRU overflow, shutdown)
                // while we were dialing; its onRevoke cleaned up the temp user.
                throw new Error("Cluster connection aborted");
            }
        }

        if (lastError) {
            // Keep the errored entry so list-connections/debug expose the failure,
            // but the temporary user is useless now — run the revocation cleanup
            // that deletes it right away instead of waiting for the entry to be
            // revoked.
            await entry.runRevokeCleanup();
            throw lastError;
        }

        this.session.logger.debug({
            id: LogId.atlasConnectSucceeded,
            context: "atlas-connect-cluster",
            message: `connected to cluster: ${atlas.clusterName}`,
            noRedaction: true,
            attributes: { ...requestIdAttr(context.requestInfo?.headers) },
        });
    }

    protected async execute(
        { projectId, clusterName, connectionType }: ToolArgs<typeof this.argsShape>,
        context: ToolExecutionContext
    ): Promise<ToolResult<typeof this.outputSchema>> {
        const ipAccessListUpdated = (await ensureCurrentIpInAccessList(this.apiClient, projectId, context)) === "added";

        const { connectionString, atlas } = await this.prepareClusterConnection(
            projectId,
            clusterName,
            connectionType,
            context
        );

        // Cluster names are only unique within a project, so the slug includes
        // the project name for disambiguation. Best-effort: a failed lookup
        // falls back to the cluster name alone rather than failing the connect.
        const projectName = await this.apiClient
            .getGroup({ params: { path: { groupId: projectId } } }, context)
            .then((group) => group.name)
            .catch(() => undefined);

        const entry = await this.session.connectionRegistry.createEntry({
            name: atlasClusterSlug(projectName, clusterName),
            clientName: this.session.mcpClient?.name,
            onRevoke: (): Promise<void> => this.deleteTemporaryUser(atlas),
        });

        // try to connect for about 5 minutes asynchronously
        void this.connectToCluster(entry, connectionString, atlas, context).catch((err: unknown) => {
            const error = err instanceof Error ? err : new Error(String(err));
            this.session.logger.error({
                id: LogId.atlasConnectFailure,
                context: "atlas-connect-cluster",
                message: `error connecting to cluster: ${error.message}`,
            });
        });

        for (let i = 0; i < 60; i++) {
            if (entry.state.tag === "connected") {
                const content: ToolResult<typeof ConnectClusterOutputSchema>["content"] = [
                    {
                        type: "text" as const,
                        text: `Connected to cluster "${clusterName}". Your connectionId is "${entry.connectionId}" — pass it as the connectionId argument to all MongoDB tool calls that should run against this cluster.`,
                    },
                ];

                if (ipAccessListUpdated) {
                    content.push({
                        type: "text" as const,
                        text: ACCESS_LIST_ADDED_NOTE,
                    });
                }

                content.push({
                    type: "text" as const,
                    text: createdUserMessage,
                });

                const baseStructuredContent = {
                    connectionId: entry.connectionId,
                    state: "connected" as const,
                    addedCurrentIp: ipAccessListUpdated,
                    createdTemporaryUser: true,
                    temporaryUserClarification: createdUserMessage,
                };

                const sharedTierFields = await this.runSharedTierHook(atlas, content, context);
                return { content, structuredContent: { ...baseStructuredContent, ...sharedTierFields } };
            }

            await sleep(500); // wait 500ms before checking the connection state again
        }

        const content: ToolResult<typeof ConnectClusterOutputSchema>["content"] = [
            {
                type: "text" as const,
                text: `Attempting to connect to cluster "${clusterName}". Your connectionId is "${entry.connectionId}" — pass it as the connectionId argument to MongoDB tool calls once the connection is established.`,
            },
            {
                type: "text" as const,
                text: `Warning: Provisioning a user and connecting to the cluster may take more time, please check again in a few seconds.`,
            },
        ];

        if (ipAccessListUpdated) {
            content.push({
                type: "text" as const,
                text: ACCESS_LIST_ADDED_NOTE,
            });
        }

        content.push({
            type: "text" as const,
            text: createdUserMessage,
        });

        const sharedTierFields = await this.runSharedTierHook(atlas, content, context);
        return {
            content,
            structuredContent: {
                connectionId: entry.connectionId,
                state: "connecting",
                addedCurrentIp: ipAccessListUpdated,
                createdTemporaryUser: true,
                temporaryUserClarification: createdUserMessage,
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

    protected override async resolveTelemetryMetadata(
        args: ToolArgs<typeof this.argsShape>,
        { result }: { result: ToolResult<typeof ConnectClusterOutputSchema> }
    ): Promise<ConnectionMetadata> {
        const parentMetadata = await super.resolveTelemetryMetadata(args, { result });
        const connectionId = result.structuredContent?.connectionId;
        const connectionMetadata = {
            ...(connectionId && { connection_id: connectionId }),
            ...this.getConnectionInfoMetadata(
                connectionId ? (await this.session.connectionRegistry.peek(connectionId))?.state : undefined
            ),
        };
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
