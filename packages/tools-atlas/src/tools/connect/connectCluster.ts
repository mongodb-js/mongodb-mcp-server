import { z } from "zod";
import { type ToolArgs, type ToolResult, LogId, requestIdAttr, sleep } from "@mongodb-js/mcp-core";
import type {
    OperationType,
    AtlasClusterConnectionInfo,
    SharedTierTier,
    SharedTierMetricName,
    ToolExecutionContext,
    ToolRequest,
} from "@mongodb-js/mcp-types";
import { SHARED_TIER_METRIC_NAMES } from "@mongodb-js/mcp-types";
import type { ConnectionMetadata } from "@mongodb-js/mcp-atlas-telemetry";
import { AtlasToolBase, type IAtlasConfig } from "../../atlasTool.js";
import { generateSecurePassword } from "../../helpers/generatePassword.js";
import { getConnectionString, inspectCluster } from "../../helpers/cluster.js";
import { ensureCurrentIpInAccessList, ACCESS_LIST_ADDED_NOTE } from "../../helpers/accessListUtils.js";
import { getDefaultRoleFromConfig } from "../../helpers/roles.js";
import { runSharedTierAlertsHook } from "../../helpers/sharedTierAlertsHook.js";
import { atlasClusterSlug, type ConnectionEntry } from "@mongodb-js/mcp-tools-mongodb";
import { AtlasArgs } from "../../args.js";

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
        request: ToolRequest<IAtlasConfig>
    ): Promise<{ connectionString: string; atlas: AtlasClusterConnectionInfo }> {
        const cluster = await inspectCluster(this.server.apiClient, projectId, clusterName, request);

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

        // 14_400_000ms (4h) is the canonical default also declared by
        // atlasTemporaryDatabaseUserLifetimeMs; the fallback guards
        // programmatic (non-CLI) construction where the config object may have
        // the field unset.
        const expiryDate = new Date(
            Date.now() + (this.server.config.atlasTemporaryDatabaseUserLifetimeMs ?? 14_400_000)
        );
        const role = getDefaultRoleFromConfig(this.server.config);

        await this.server.apiClient.createDatabaseUser({
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

        this.server.keychain.register(username, "user");
        this.server.keychain.register(password, "password");

        return { connectionString: cn.toString(), atlas: connectedAtlasCluster };
    }

    private async deleteTemporaryUser(atlas: AtlasClusterConnectionInfo): Promise<void> {
        if (!atlas.username) {
            return;
        }
        await this.server.apiClient
            .deleteDatabaseUser({
                params: {
                    path: {
                        groupId: atlas.projectId,
                        username: atlas.username,
                        databaseName: "admin",
                    },
                },
            })
            .catch((err: unknown) => {
                const error = err instanceof Error ? err : new Error(String(err));
                this.server.logger.debug({
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
        request: ToolRequest<IAtlasConfig>
    ): Promise<void> {
        let lastError: Error | undefined = undefined;

        this.server.logger.debug({
            id: LogId.atlasConnectAttempt,
            context: "atlas-connect-cluster",
            message: `attempting to connect to cluster: ${atlas.clusterName}`,
            noRedaction: true,
            attributes: { ...requestIdAttr(request.headers) },
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

                this.server.logger.debug({
                    id: LogId.atlasConnectFailure,
                    context: "atlas-connect-cluster",
                    message: `error connecting to cluster: ${error.message}`,
                    attributes: { ...requestIdAttr(request.headers) },
                });

                await sleep(500); // wait for 500ms before retrying
            }

            if ((await this.server.connectionRegistry.peek(entry.connectionId)) !== entry) {
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

        this.server.logger.debug({
            id: LogId.atlasConnectSucceeded,
            context: "atlas-connect-cluster",
            message: `connected to cluster: ${atlas.clusterName}`,
            noRedaction: true,
            attributes: { ...requestIdAttr(request.headers) },
        });
    }

    protected async execute(
        { projectId, clusterName, connectionType }: ToolArgs<typeof this.argsShape>,
        { request }: ToolExecutionContext
    ): Promise<ToolResult<typeof this.outputSchema>> {
        const ipAccessListUpdated =
            (await ensureCurrentIpInAccessList(this.server.apiClient, projectId, request)) === "added";

        // Models are expected to poll this tool while a dial is in progress, so
        // a repeat call for a cluster that is already connecting or connected
        // reuses the in-flight entry: every sibling entry would provision
        // another temporary user and start another background dial loop.
        let entry = (
            await this.server.connectionRegistry.find(
                (candidate) =>
                    (candidate.state.tag === "connected" || candidate.state.tag === "connecting") &&
                    candidate.state.connectedAtlasCluster?.projectId === projectId &&
                    candidate.state.connectedAtlasCluster?.clusterName === clusterName
            )
        )[0];
        let atlas = entry?.state.connectedAtlasCluster;
        const createdTemporaryUser = !entry;

        if (!entry) {
            const prepared = await this.prepareClusterConnection(projectId, clusterName, connectionType, request);
            atlas = prepared.atlas;

            // Cluster names are only unique within a project, so the slug includes
            // the project name for disambiguation. Best-effort: a failed lookup
            // falls back to the cluster name alone rather than failing the connect.
            const projectName = await this.server.apiClient
                .getGroup({ params: { path: { groupId: projectId } } }, request)
                .then((group) => group.name)
                .catch(() => undefined);

            entry = await this.server.connectionRegistry.createEntry({
                name: atlasClusterSlug(projectName, clusterName),
                clientName: request.clientInfo?.name,
                onRevoke: (): Promise<void> => this.deleteTemporaryUser(prepared.atlas),
            });

            // try to connect for about 5 minutes asynchronously
            void this.connectToCluster(entry, prepared.connectionString, prepared.atlas, request).catch(
                (err: unknown) => {
                    const error = err instanceof Error ? err : new Error(String(err));
                    this.server.logger.error({
                        id: LogId.atlasConnectFailure,
                        context: "atlas-connect-cluster",
                        message: `error connecting to cluster: ${error.message}`,
                    });
                }
            );
        }

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

                if (createdTemporaryUser) {
                    content.push({
                        type: "text" as const,
                        text: createdUserMessage,
                    });
                }

                const baseStructuredContent = {
                    connectionId: entry.connectionId,
                    state: "connected" as const,
                    addedCurrentIp: ipAccessListUpdated,
                    createdTemporaryUser,
                    ...(createdTemporaryUser && { temporaryUserClarification: createdUserMessage }),
                };

                const sharedTierFields = await this.runSharedTierHook(atlas, content, request);
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

        if (createdTemporaryUser) {
            content.push({
                type: "text" as const,
                text: createdUserMessage,
            });
        }

        const sharedTierFields = await this.runSharedTierHook(atlas, content, request);
        return {
            content,
            structuredContent: {
                connectionId: entry.connectionId,
                state: "connecting",
                addedCurrentIp: ipAccessListUpdated,
                createdTemporaryUser,
                ...(createdTemporaryUser && { temporaryUserClarification: createdUserMessage }),
                ...sharedTierFields,
            },
        };
    }

    private async runSharedTierHook(
        atlas: AtlasClusterConnectionInfo | undefined,
        content: ToolResult<typeof ConnectClusterOutputSchema>["content"],
        request: ToolRequest<IAtlasConfig>
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
            apiClient: this.server.apiClient,
            logger: this.server.logger,
            context: request,
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
                connectionId ? (await this.server.connectionRegistry.peek(connectionId))?.state : undefined
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
