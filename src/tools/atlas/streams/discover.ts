import { z } from "zod";
import { StreamsToolBase } from "./streamsToolBase.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { OperationType, ToolArgs, ToolExecutionContext } from "../../tool.js";
import { formatUntrustedData } from "../../tool.js";
import { AtlasArgs } from "../../args.js";
import { StreamsArgs } from "./streamsArgs.js";
import type { StreamsProcessorWithStats } from "../../../common/atlas/openapi.js";

const DiscoverAction = z.enum([
    "list-workspaces",
    "inspect-workspace",
    "list-connections",
    "inspect-connection",
    "list-processors",
    "inspect-processor",
    "diagnose-processor",
    "get-networking",
]);

const ResponseFormat = z.enum(["concise", "detailed"]);

const WorkspaceSummarySchema = z.object({
    name: z.string(),
    region: z.string(),
    tier: z.string(),
    maxTier: z.string(),
});

const WorkspaceInspectConciseSchema = WorkspaceSummarySchema.extend({
    connectionCount: z.number().int().nonnegative(),
});

const ConnectionSummarySchema = z.object({
    name: z.string(),
    type: z.string().optional(),
    state: z.string().optional(),
});

type ConnectionSummary = z.infer<typeof ConnectionSummarySchema>;

function toConnectionSummary(c: unknown): ConnectionSummary {
    const conn = c as Record<string, unknown>;
    return {
        name: conn.name,
        type: conn.type,
        state: conn.state,
    } as ConnectionSummary;
}

const ConnectionInspectSchema = ConnectionSummarySchema.omit({ name: true }).extend({
    region: z.string().optional(),
    clusterName: z.string().optional(),
    bootstrapServers: z.union([z.string(), z.array(z.string())]).optional(),
});

type ConnectionInspect = z.infer<typeof ConnectionInspectSchema>;

function toConnectionInspect(data: Record<string, unknown>): ConnectionInspect {
    const summary = toConnectionSummary(data);
    return {
        ...(summary.type !== undefined && { type: summary.type }),
        ...(summary.state !== undefined && { state: summary.state }),
        ...(data.region !== undefined && { region: data.region }),
        ...(data.clusterName !== undefined && { clusterName: data.clusterName }),
        ...(data.bootstrapServers !== undefined && { bootstrapServers: data.bootstrapServers }),
    } as ConnectionInspect;
}

const ProcessorSummarySchema = z.object({
    name: z.string(),
    state: z.string().optional(),
    tier: z.string().optional(),
});

const ProcessorState = z.enum(["STARTED", "STOPPED", "CREATED", "FAILED"]);

const ProcessorStatsSchema = z.object({
    inputMessageCount: z.number().optional(),
    outputMessageCount: z.number().optional(),
    dlqMessageCount: z.number().optional(),
});

const DlqConfigSchema = z.object({
    connectionName: z.string().optional(),
    db: z.string().optional(),
    coll: z.string().optional(),
});

const PrivateLinkSummarySchema = z.object({
    id: z.string(),
    provider: z.string().optional(),
    region: z.string().optional(),
    state: z.string().optional(),
    vendor: z.string().optional(),
});

const AccountDetailsSummarySchema = z.object({
    awsAccountId: z.string().optional(),
    azureSubscriptionId: z.string().optional(),
    gcpProjectId: z.string().optional(),
    cidrBlock: z.string().optional(),
    vpcId: z.string().optional(),
    virtualNetworkName: z.string().optional(),
    vpcNetworkName: z.string().optional(),
});

type PrivateLinkSummary = z.infer<typeof PrivateLinkSummarySchema>;
type AccountDetailsSummary = z.infer<typeof AccountDetailsSummarySchema>;

function toPrivateLinkSummary(pl: {
    _id?: string;
    provider?: string;
    region?: string;
    state?: string;
    vendor?: string;
}): PrivateLinkSummary | undefined {
    if (!pl._id) {
        return undefined;
    }
    return {
        id: pl._id,
        provider: pl.provider,
        region: pl.region,
        state: pl.state,
        vendor: pl.vendor,
    } as PrivateLinkSummary;
}

function toAccountDetailsSummary(data: Record<string, unknown>): AccountDetailsSummary {
    return {
        ...(data.awsAccountId !== undefined && { awsAccountId: data.awsAccountId }),
        ...(data.azureSubscriptionId !== undefined && { azureSubscriptionId: data.azureSubscriptionId }),
        ...(data.gcpProjectId !== undefined && { gcpProjectId: data.gcpProjectId }),
        ...(data.cidrBlock !== undefined && { cidrBlock: data.cidrBlock }),
        ...(data.vpcId !== undefined && { vpcId: data.vpcId }),
        ...(data.virtualNetworkName !== undefined && { virtualNetworkName: data.virtualNetworkName }),
        ...(data.vpcNetworkName !== undefined && { vpcNetworkName: data.vpcNetworkName }),
    } as AccountDetailsSummary;
}

export const DiscoverOutputSchema = z.object({
    workspaces: z.array(WorkspaceSummarySchema).optional(),
    connections: z.array(ConnectionSummarySchema).optional(),
    processors: z.array(ProcessorSummarySchema).optional(),
    workspace: WorkspaceInspectConciseSchema.optional(),
    processorState: ProcessorState.optional(),
    tier: z.string().optional(),
    stats: ProcessorStatsSchema.optional(),
    dlq: DlqConfigSchema.optional(),
    pipeline: z.array(z.record(z.string(), z.unknown())).optional(),
    connectionHealth: z.array(ConnectionSummarySchema).optional(),
    connection: ConnectionInspectSchema.optional(),
    privateLinks: z.array(PrivateLinkSummarySchema).optional(),
    accountDetails: AccountDetailsSummarySchema.optional(),
});

export type DiscoverOutput = z.infer<typeof DiscoverOutputSchema>;

function buildProcessorStructuredContent(
    proc: StreamsProcessorWithStats,
    { includePipeline = false }: { includePipeline?: boolean } = {}
): DiscoverOutput {
    const structuredContent: DiscoverOutput = {};

    const parsedState = ProcessorState.safeParse(proc.state);
    if (parsedState.success) {
        structuredContent.processorState = parsedState.data;
    }
    if (proc.tier !== undefined) {
        structuredContent.tier = proc.tier;
    }
    if (proc.stats && Object.keys(proc.stats).length > 0) {
        structuredContent.stats = {
            inputMessageCount: Number(proc.stats.inputMessageCount ?? 0),
            outputMessageCount: Number(proc.stats.outputMessageCount ?? 0),
            dlqMessageCount: Number(proc.stats.dlqMessageCount ?? 0),
        };
    }
    if (proc.options?.dlq) {
        structuredContent.dlq = {
            connectionName: proc.options.dlq.connectionName,
            db: proc.options.dlq.db,
            coll: proc.options.dlq.coll,
        };
    }
    if (includePipeline && proc.pipeline) {
        structuredContent.pipeline = proc.pipeline;
    }

    return structuredContent;
}

export class StreamsDiscoverTool extends StreamsToolBase {
    static toolName = "atlas-streams-discover";
    static operationType: OperationType = "read";

    public description =
        "Discover and inspect Atlas Stream Processing resources. " +
        "Also use for 'why is my processor failing', 'what workspaces do I have', 'show processor stats', or 'check processor health'. " +
        "Use 'list-workspaces' to see all workspaces in a project. " +
        "Use inspect actions for details on a specific resource. " +
        "Use 'diagnose-processor' for a combined health report including state, stats, connection health, and recent errors. " +
        "Use 'get-networking' for PrivateLink and account details.";

    public argsShape = {
        projectId: AtlasArgs.projectId().describe(
            "Atlas project ID. Use atlas-list-projects to find project IDs if not available."
        ),
        action: DiscoverAction.describe(
            "What to look up. Start with 'list-workspaces' to see available workspaces, " +
                "then use inspect actions for details or 'diagnose-processor' for a health report."
        ),
        workspaceName: StreamsArgs.workspaceName()
            .optional()
            .describe("Workspace name. Required for all actions except 'list-workspaces' and 'get-networking'."),
        resourceName: z
            .string()
            .optional()
            .describe(
                "Connection or processor name. Required for 'inspect-connection', 'inspect-processor', and 'diagnose-processor'."
            ),
        responseFormat: ResponseFormat.optional().describe(
            "Response detail level. 'concise' returns names and states only. " +
                "'detailed' returns full configuration and stats. " +
                "Default: 'concise' for list actions, 'detailed' for inspect/diagnose."
        ),
        cloudProvider: z
            .string()
            .optional()
            .describe(
                "Cloud provider (AWS, AZURE, GCP). Only for 'get-networking': returns account details for the specified provider."
            ),
        region: z
            .string()
            .optional()
            .describe("Cloud region. Only for 'get-networking': returns account details for the specified region."),
        limit: z
            .number()
            .int()
            .min(1)
            .max(100)
            .optional()
            .describe("Max results per page for list actions. Default: 20."),
        pageNum: z.number().int().min(1).optional().describe("Page number for list actions. Default: 1."),
    };

    public override outputSchema = DiscoverOutputSchema.shape;

    protected async execute(
        {
            projectId,
            action,
            workspaceName,
            resourceName,
            responseFormat,
            cloudProvider,
            region,
            limit,
            pageNum,
        }: ToolArgs<typeof this.argsShape>,
        context: ToolExecutionContext
    ): Promise<CallToolResult> {
        switch (action) {
            case "list-workspaces":
                return this.listWorkspaces(projectId, responseFormat, limit, pageNum, context);
            case "inspect-workspace":
                return this.inspectWorkspace(
                    projectId,
                    this.requireWorkspaceName(workspaceName),
                    responseFormat,
                    context
                );
            case "list-connections":
                return this.listConnections(
                    projectId,
                    this.requireWorkspaceName(workspaceName),
                    responseFormat,
                    limit,
                    pageNum,
                    context
                );
            case "inspect-connection":
                return this.inspectConnection(
                    projectId,
                    this.requireWorkspaceName(workspaceName),
                    this.requireResourceName(resourceName, "connection"),
                    context
                );
            case "list-processors":
                return this.listProcessors(
                    projectId,
                    this.requireWorkspaceName(workspaceName),
                    responseFormat,
                    limit,
                    pageNum,
                    context
                );
            case "inspect-processor":
                return this.inspectProcessor(
                    projectId,
                    this.requireWorkspaceName(workspaceName),
                    this.requireResourceName(resourceName, "processor"),
                    context
                );
            case "diagnose-processor":
                return this.diagnoseProcessor(
                    projectId,
                    this.requireWorkspaceName(workspaceName),
                    this.requireResourceName(resourceName, "processor"),
                    context
                );
            case "get-networking":
                return this.getNetworking(projectId, cloudProvider, region, context);
            default:
                return {
                    content: [{ type: "text", text: `Unknown action: ${action as string}` }],
                    isError: true,
                };
        }
    }

    private requireWorkspaceName(workspaceName: string | undefined): string {
        if (!workspaceName) {
            throw new Error(
                "workspaceName is required for this action. Use action 'list-workspaces' to see available workspaces."
            );
        }
        return workspaceName;
    }

    private requireResourceName(resourceName: string | undefined, resourceType: string): string {
        if (!resourceName) {
            throw new Error(
                `resourceName is required to inspect a ${resourceType}. ` +
                    `Use 'list-${resourceType}s' action to see available ${resourceType}s.`
            );
        }
        return resourceName;
    }

    private async listWorkspaces(
        projectId: string,
        responseFormat: string | undefined,
        limit: number | undefined,
        pageNum: number | undefined,
        context: ToolExecutionContext
    ): Promise<CallToolResult> {
        const data = await this.apiClient.listStreamWorkspaces(
            {
                params: { path: { groupId: projectId }, query: { itemsPerPage: limit ?? 20, pageNum: pageNum ?? 1 } },
            },
            context
        );

        if (!data?.results?.length) {
            return {
                content: [
                    {
                        type: "text",
                        text: "No Stream Processing workspaces found in this project. Use `atlas-streams-build` with resource='workspace' to create one.",
                    },
                ],
                structuredContent: { workspaces: [] },
            };
        }

        const format = responseFormat ?? "concise";
        const conciseWorkspaces = data.results.map((w) => ({
            name: w.name,
            region: w.dataProcessRegion
                ? `${w.dataProcessRegion.cloudProvider}/${w.dataProcessRegion.region}`
                : "unknown",
            tier: w.streamConfig?.tier ?? "unknown",
            maxTier: w.streamConfig?.maxTierSize ?? "unknown",
        }));
        const workspaces = format === "concise" ? conciseWorkspaces : data.results;

        return {
            content: formatUntrustedData(
                `Found ${data.results.length} workspace(s) (total: ${data.totalCount ?? data.results.length}):`,
                JSON.stringify(workspaces, null, 2)
            ),
            structuredContent: { workspaces: conciseWorkspaces },
        };
    }

    private async inspectWorkspace(
        projectId: string,
        workspaceName: string,
        responseFormat: string | undefined,
        context: ToolExecutionContext
    ): Promise<CallToolResult> {
        const data = await this.apiClient.getStreamWorkspace(
            {
                params: {
                    path: { groupId: projectId, tenantName: workspaceName },
                    query: { includeConnections: true },
                },
            },
            context
        );
        if (!data) {
            throw new Error(`Workspace '${workspaceName}' not found.`);
        }

        const format = responseFormat ?? "detailed";
        const conciseWorkspace = {
            name: data.name,
            region: data.dataProcessRegion
                ? `${data.dataProcessRegion.cloudProvider}/${data.dataProcessRegion.region}`
                : "unknown",
            tier: data.streamConfig?.tier ?? "unknown",
            maxTier: data.streamConfig?.maxTierSize ?? "unknown",
            connectionCount: data.connections?.length ?? 0,
        };
        const output = format === "concise" ? conciseWorkspace : data;

        return {
            content: formatUntrustedData(`Workspace '${workspaceName}' details:`, JSON.stringify(output, null, 2)),
            structuredContent: { workspace: conciseWorkspace },
        };
    }

    private async listConnections(
        projectId: string,
        workspaceName: string,
        responseFormat: string | undefined,
        limit: number | undefined,
        pageNum: number | undefined,
        context: ToolExecutionContext
    ): Promise<CallToolResult> {
        const data = await this.apiClient.listStreamConnections(
            {
                params: {
                    path: { groupId: projectId, tenantName: workspaceName },
                    query: { itemsPerPage: limit ?? 20, pageNum: pageNum ?? 1 },
                },
            },
            context
        );

        if (!data?.results?.length) {
            return {
                content: [
                    {
                        type: "text",
                        text: `No connections found in workspace '${workspaceName}'. Use \`atlas-streams-build\` with resource='connection' to add one.`,
                    },
                ],
                structuredContent: { connections: [] },
            };
        }

        const format = responseFormat ?? "concise";
        const conciseConnections = data.results.map(toConnectionSummary);
        const connections = format === "concise" ? conciseConnections : data.results;

        return {
            content: formatUntrustedData(
                `Found ${data.results.length} connection(s) in workspace '${workspaceName}':`,
                JSON.stringify(connections, null, 2)
            ),
            structuredContent: { connections: conciseConnections },
        };
    }

    private async inspectConnection(
        projectId: string,
        workspaceName: string,
        connectionName: string,
        context: ToolExecutionContext
    ): Promise<CallToolResult> {
        const data = (await this.apiClient.getStreamConnection(
            {
                params: { path: { groupId: projectId, tenantName: workspaceName, connectionName } },
            },
            context
        )) as Record<string, unknown>;

        let header = `Connection '${connectionName}' in workspace '${workspaceName}':`;

        if (data.type === "Cluster" && typeof data.clusterName === "string" && data.clusterName !== data.name) {
            header +=
                `\n\nNote: This connection is named '${String(data.name)}' but targets cluster '${data.clusterName}'. ` +
                `Use the connection name '${String(data.name)}' (not the cluster name) when referencing it in pipeline stages.`;
        }

        const connection = toConnectionInspect(data);

        return {
            content: formatUntrustedData(header, JSON.stringify(data, null, 2)),
            ...(Object.keys(connection).length > 0 && { structuredContent: { connection } }),
        };
    }

    private async listProcessors(
        projectId: string,
        workspaceName: string,
        responseFormat: string | undefined,
        limit: number | undefined,
        pageNum: number | undefined,
        context: ToolExecutionContext
    ): Promise<CallToolResult> {
        const data = await this.apiClient.getStreamProcessors(
            {
                params: {
                    path: { groupId: projectId, tenantName: workspaceName },
                    query: { itemsPerPage: limit ?? 20, pageNum: pageNum ?? 1 },
                },
            },
            context
        );

        if (!data?.results?.length) {
            return {
                content: [
                    {
                        type: "text",
                        text: `No processors found in workspace '${workspaceName}'. Use \`atlas-streams-build\` with resource='processor' to deploy one.`,
                    },
                ],
                structuredContent: { processors: [] },
            };
        }

        const format = responseFormat ?? "concise";
        const conciseProcessors = data.results.map((p) => ({
            name: p.name,
            state: p.state,
            tier: p.tier,
        }));
        const processors = format === "concise" ? conciseProcessors : data.results;

        return {
            content: formatUntrustedData(
                `Found ${data.results.length} processor(s) in workspace '${workspaceName}':`,
                JSON.stringify(processors, null, 2)
            ),
            structuredContent: { processors: conciseProcessors },
        };
    }

    private async inspectProcessor(
        projectId: string,
        workspaceName: string,
        processorName: string,
        context: ToolExecutionContext
    ): Promise<CallToolResult> {
        const data = await this.apiClient.getStreamProcessor(
            {
                params: { path: { groupId: projectId, tenantName: workspaceName, processorName } },
            },
            context
        );
        const structuredContent = buildProcessorStructuredContent(data, { includePipeline: true });

        return {
            content: formatUntrustedData(
                `Processor '${processorName}' in workspace '${workspaceName}':`,
                JSON.stringify(data, null, 2)
            ),
            ...(Object.keys(structuredContent).length > 0 && { structuredContent }),
        };
    }

    private async diagnoseProcessor(
        projectId: string,
        workspaceName: string,
        processorName: string,
        context: ToolExecutionContext
    ): Promise<CallToolResult> {
        const [processorResult, connectionsResult] = await Promise.allSettled([
            this.apiClient.getStreamProcessor(
                {
                    params: { path: { groupId: projectId, tenantName: workspaceName, processorName } },
                },
                context
            ),
            this.apiClient.listStreamConnections(
                {
                    params: { path: { groupId: projectId, tenantName: workspaceName } },
                },
                context
            ),
        ]);

        const sections: string[] = [];
        const structuredContent: DiscoverOutput = {};

        // Processor state and stats
        if (processorResult.status === "fulfilled" && processorResult.value) {
            const proc = processorResult.value;
            Object.assign(structuredContent, buildProcessorStructuredContent(proc));

            sections.push(
                `## Processor State\n- Name: ${proc.name}\n- State: ${proc.state}\n- Tier: ${proc.tier ?? "default"}`
            );

            if (proc.stats && Object.keys(proc.stats).length > 0 && structuredContent.stats) {
                const stats = structuredContent.stats;
                sections.push(`## Processor Stats\n${JSON.stringify(stats, null, 2)}`);

                const inputCount = stats.inputMessageCount ?? 0;
                const outputCount = stats.outputMessageCount ?? 0;
                const dlqCount = stats.dlqMessageCount ?? 0;

                if (inputCount > 0 && outputCount === 0 && dlqCount > 0) {
                    const healthWarning =
                        `All ${dlqCount} input messages went to DLQ (0 successful outputs). ` +
                        `This typically indicates a schema mismatch, serialization error, or sink configuration problem. ` +
                        `Query the DLQ collection to inspect error details.`;
                    sections.push(`## Health Warning\n${healthWarning}`);
                } else if (inputCount > 0 && dlqCount > 0) {
                    const dlqRatio = Math.round((dlqCount / inputCount) * 100);
                    if (dlqRatio > 50) {
                        const healthWarning = `${dlqRatio}% of messages going to DLQ. Check DLQ collection for error patterns.`;
                        sections.push(`## Health Warning\n${healthWarning}`);
                    }
                }
            }

            if (proc.options?.dlq) {
                sections.push(
                    `## Dead Letter Queue Config\n- Connection: ${proc.options.dlq.connectionName}\n- Database: ${proc.options.dlq.db}\n- Collection: ${proc.options.dlq.coll}`
                );
            }

            if (proc.pipeline) {
                sections.push(`## Pipeline\n${JSON.stringify(proc.pipeline, null, 2)}`);
            }
        } else {
            const processorError =
                processorResult.status === "rejected" ? String(processorResult.reason) : "No data returned";
            sections.push(`## Processor State\nError fetching processor: ${processorError}`);
        }

        // Connection health
        if (connectionsResult.status === "fulfilled" && connectionsResult.value?.results?.length) {
            const connections = connectionsResult.value.results;
            structuredContent.connectionHealth = connections.map(toConnectionSummary);
            const summary = connections
                .map((c) => {
                    const conn = c as Record<string, unknown>;
                    return `- ${String(conn.name)} (${String(conn.type)}): ${String(conn.state)}`;
                })
                .join("\n");
            sections.push(`## Connection Health\n${summary}`);
        }

        // Actionable guidance
        const proc = processorResult.status === "fulfilled" ? processorResult.value : undefined;
        if (proc?.state === "FAILED") {
            sections.push(
                "## Recommended Actions\n" +
                    "- Check the Dead Letter Queue for failed documents\n" +
                    "- Use `atlas-streams-manage` with action 'modify-processor' to fix pipeline issues (processor must be stopped)\n" +
                    "- Use `atlas-streams-manage` with action 'start-processor' and resumeFromCheckpoint=false to restart from the beginning"
            );
        } else if (proc?.state === "STOPPED") {
            sections.push(
                "## Recommended Actions\n- Use `atlas-streams-manage` with action 'start-processor' to resume processing"
            );
        }

        return {
            content: formatUntrustedData(
                `Diagnostic report for processor '${processorName}' in workspace '${workspaceName}':`,
                sections.join("\n\n")
            ),
            ...(Object.keys(structuredContent).length > 0 && { structuredContent }),
        };
    }

    private async getNetworking(
        projectId: string,
        cloudProvider: string | undefined,
        region: string | undefined,
        context: ToolExecutionContext
    ): Promise<CallToolResult> {
        const [privateLinkResult] = await Promise.allSettled([
            this.apiClient.listPrivateLinkConnections(
                {
                    params: { path: { groupId: projectId } },
                },
                context
            ),
        ]);

        const sections: string[] = [];
        const structuredContent: DiscoverOutput = { privateLinks: [] };

        if (cloudProvider && region) {
            try {
                const accountDetails = await this.apiClient.getAccountDetails(
                    {
                        params: {
                            path: { groupId: projectId },
                            query: { cloudProvider, regionName: region },
                        },
                    },
                    context
                );
                const accountDetailsSummary = toAccountDetailsSummary(accountDetails as Record<string, unknown>);
                if (Object.keys(accountDetailsSummary).length > 0) {
                    structuredContent.accountDetails = accountDetailsSummary;
                }
                sections.push(
                    `## Account Details (${cloudProvider}/${region})\n${JSON.stringify(accountDetails, null, 2)}`
                );
            } catch {
                sections.push(`## Account Details\nCould not fetch account details for ${cloudProvider}/${region}.`);
            }
        }

        if (privateLinkResult.status === "fulfilled" && privateLinkResult.value?.results?.length) {
            const results = privateLinkResult.value.results;
            structuredContent.privateLinks = results
                .map(toPrivateLinkSummary)
                .filter((pl): pl is PrivateLinkSummary => pl !== undefined);

            const pls = results.map((pl) => ({
                id: pl._id,
                provider: pl.provider,
                region: pl.region,
                state: pl.state,
                vendor: pl.vendor,
                ...(pl.errorMessage && { errorMessage: pl.errorMessage }),
            }));

            sections.push(`## PrivateLink Connections\n${JSON.stringify(pls, null, 2)}`);
        } else {
            sections.push("## PrivateLink Connections\nNo PrivateLink connections found.");
        }

        return {
            content: formatUntrustedData("Streams networking details:", sections.join("\n\n")),
            structuredContent,
        };
    }
}
