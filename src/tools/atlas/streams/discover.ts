import { z } from "zod";
import { StreamsToolBase } from "./streamsToolBase.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { OperationType, ToolArgs } from "../../tool.js";
import { formatUntrustedData } from "../../tool.js";
import { AtlasArgs } from "../../args.js";
import { StreamsArgs } from "./streamsArgs.js";

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

    protected async execute({
        projectId,
        action,
        workspaceName,
        resourceName,
        responseFormat,
        cloudProvider,
        region,
        limit,
        pageNum,
    }: ToolArgs<typeof this.argsShape>): Promise<CallToolResult> {
        switch (action) {
            case "list-workspaces":
                return this.listWorkspaces(projectId, responseFormat, limit, pageNum);
            case "inspect-workspace":
                return this.inspectWorkspace(projectId, this.requireWorkspaceName(workspaceName), responseFormat);
            case "list-connections":
                return this.listConnections(
                    projectId,
                    this.requireWorkspaceName(workspaceName),
                    responseFormat,
                    limit,
                    pageNum
                );
            case "inspect-connection":
                return this.inspectConnection(
                    projectId,
                    this.requireWorkspaceName(workspaceName),
                    this.requireResourceName(resourceName, "connection")
                );
            case "list-processors":
                return this.listProcessors(
                    projectId,
                    this.requireWorkspaceName(workspaceName),
                    responseFormat,
                    limit,
                    pageNum
                );
            case "inspect-processor":
                return this.inspectProcessor(
                    projectId,
                    this.requireWorkspaceName(workspaceName),
                    this.requireResourceName(resourceName, "processor")
                );
            case "diagnose-processor":
                return this.diagnoseProcessor(
                    projectId,
                    this.requireWorkspaceName(workspaceName),
                    this.requireResourceName(resourceName, "processor")
                );
            case "get-networking":
                return this.getNetworking(projectId, cloudProvider, region);
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
        pageNum: number | undefined
    ): Promise<CallToolResult> {
        const data = await this.apiClient.listStreamWorkspaces({
            params: { path: { groupId: projectId }, query: { itemsPerPage: limit ?? 20, pageNum: pageNum ?? 1 } },
        });

        if (!data?.results?.length) {
            return {
                content: [
                    {
                        type: "text",
                        text: "No Stream Processing workspaces found in this project. Use `atlas-streams-build` with resource='workspace' to create one.",
                    },
                ],
            };
        }

        const format = responseFormat ?? "concise";
        const workspaces =
            format === "concise"
                ? data.results.map((w) => ({
                      name: w.name,
                      region: w.dataProcessRegion
                          ? `${w.dataProcessRegion.cloudProvider}/${w.dataProcessRegion.region}`
                          : "unknown",
                      tier: w.streamConfig?.tier ?? "unknown",
                      maxTier: w.streamConfig?.maxTierSize ?? "unknown",
                  }))
                : data.results;

        return {
            content: formatUntrustedData(
                `Found ${data.results.length} workspace(s) (total: ${data.totalCount ?? data.results.length}):`,
                JSON.stringify(workspaces, null, 2)
            ),
        };
    }

    private async inspectWorkspace(
        projectId: string,
        workspaceName: string,
        responseFormat: string | undefined
    ): Promise<CallToolResult> {
        const data = await this.apiClient.getStreamWorkspace({
            params: { path: { groupId: projectId, tenantName: workspaceName }, query: { includeConnections: true } },
        });
        if (!data) {
            throw new Error(`Workspace '${workspaceName}' not found.`);
        }

        const format = responseFormat ?? "detailed";
        const output =
            format === "concise"
                ? {
                      name: data.name,
                      region: data.dataProcessRegion
                          ? `${data.dataProcessRegion.cloudProvider}/${data.dataProcessRegion.region}`
                          : "unknown",
                      tier: data.streamConfig?.tier ?? "unknown",
                      maxTier: data.streamConfig?.maxTierSize ?? "unknown",
                      connectionCount: data.connections?.length ?? 0,
                  }
                : data;

        return {
            content: formatUntrustedData(`Workspace '${workspaceName}' details:`, JSON.stringify(output, null, 2)),
        };
    }

    private async listConnections(
        projectId: string,
        workspaceName: string,
        responseFormat: string | undefined,
        limit: number | undefined,
        pageNum: number | undefined
    ): Promise<CallToolResult> {
        const data = await this.apiClient.listStreamConnections({
            params: {
                path: { groupId: projectId, tenantName: workspaceName },
                query: { itemsPerPage: limit ?? 20, pageNum: pageNum ?? 1 },
            },
        });

        if (!data?.results?.length) {
            return {
                content: [
                    {
                        type: "text",
                        text: `No connections found in workspace '${workspaceName}'. Use \`atlas-streams-build\` with resource='connection' to add one.`,
                    },
                ],
            };
        }

        const format = responseFormat ?? "concise";
        const connections =
            format === "concise"
                ? data.results.map((c) => {
                      const conn = c as Record<string, unknown>;
                      return {
                          name: conn.name,
                          type: conn.type,
                          state: conn.state,
                      };
                  })
                : data.results;

        return {
            content: formatUntrustedData(
                `Found ${data.results.length} connection(s) in workspace '${workspaceName}':`,
                JSON.stringify(connections, null, 2)
            ),
        };
    }

    private async inspectConnection(
        projectId: string,
        workspaceName: string,
        connectionName: string
    ): Promise<CallToolResult> {
        const data = (await this.apiClient.getStreamConnection({
            params: { path: { groupId: projectId, tenantName: workspaceName, connectionName } },
        })) as Record<string, unknown>;

        let header = `Connection '${connectionName}' in workspace '${workspaceName}':`;

        if (data.type === "Cluster" && typeof data.clusterName === "string" && data.clusterName !== data.name) {
            header +=
                `\n\nNote: This connection is named '${String(data.name)}' but targets cluster '${data.clusterName}'. ` +
                `Use the connection name '${String(data.name)}' (not the cluster name) when referencing it in pipeline stages.`;
        }

        return {
            content: formatUntrustedData(header, JSON.stringify(data, null, 2)),
        };
    }

    private async listProcessors(
        projectId: string,
        workspaceName: string,
        responseFormat: string | undefined,
        limit: number | undefined,
        pageNum: number | undefined
    ): Promise<CallToolResult> {
        const data = await this.apiClient.getStreamProcessors({
            params: {
                path: { groupId: projectId, tenantName: workspaceName },
                query: { itemsPerPage: limit ?? 20, pageNum: pageNum ?? 1 },
            },
        });

        if (!data?.results?.length) {
            return {
                content: [
                    {
                        type: "text",
                        text: `No processors found in workspace '${workspaceName}'. Use \`atlas-streams-build\` with resource='processor' to deploy one.`,
                    },
                ],
            };
        }

        const format = responseFormat ?? "concise";
        const processors =
            format === "concise"
                ? data.results.map((p) => ({
                      name: p.name,
                      state: p.state,
                      tier: p.tier,
                  }))
                : data.results;

        return {
            content: formatUntrustedData(
                `Found ${data.results.length} processor(s) in workspace '${workspaceName}':`,
                JSON.stringify(processors, null, 2)
            ),
        };
    }

    private async inspectProcessor(
        projectId: string,
        workspaceName: string,
        processorName: string
    ): Promise<CallToolResult> {
        const data = await this.apiClient.getStreamProcessor({
            params: { path: { groupId: projectId, tenantName: workspaceName, processorName } },
        });
        return {
            content: formatUntrustedData(
                `Processor '${processorName}' in workspace '${workspaceName}':`,
                JSON.stringify(data, null, 2)
            ),
        };
    }

    private async diagnoseProcessor(
        projectId: string,
        workspaceName: string,
        processorName: string
    ): Promise<CallToolResult> {
        const [processorResult, connectionsResult] = await Promise.allSettled([
            this.apiClient.getStreamProcessor({
                params: { path: { groupId: projectId, tenantName: workspaceName, processorName } },
            }),
            this.apiClient.listStreamConnections({
                params: { path: { groupId: projectId, tenantName: workspaceName } },
            }),
        ]);

        const sections: string[] = [];

        // Processor state and stats
        if (processorResult.status === "fulfilled" && processorResult.value) {
            const proc = processorResult.value;
            sections.push(
                `## Processor State\n- Name: ${proc.name}\n- State: ${proc.state}\n- Tier: ${proc.tier ?? "default"}`
            );

            if (proc.stats && Object.keys(proc.stats).length > 0) {
                sections.push(`## Processor Stats\n${JSON.stringify(proc.stats, null, 2)}`);

                // Add health interpretation based on stats
                const stats = proc.stats as Record<string, unknown>;
                const inputCount = Number(stats.inputMessageCount ?? 0);
                const outputCount = Number(stats.outputMessageCount ?? 0);
                const dlqCount = Number(stats.dlqMessageCount ?? 0);

                if (inputCount > 0 && outputCount === 0 && dlqCount > 0) {
                    sections.push(
                        `## Health Warning\n` +
                            `All ${dlqCount} input messages went to DLQ (0 successful outputs). ` +
                            `This typically indicates a schema mismatch, serialization error, or sink configuration problem. ` +
                            `Query the DLQ collection to inspect error details.`
                    );
                } else if (inputCount > 0 && dlqCount > 0) {
                    const dlqRatio = Math.round((dlqCount / inputCount) * 100);
                    if (dlqRatio > 50) {
                        sections.push(
                            `## Health Warning\n` +
                                `${dlqRatio}% of messages going to DLQ. Check DLQ collection for error patterns.`
                        );
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
            sections.push(
                `## Processor State\nError fetching processor: ${processorResult.status === "rejected" ? String(processorResult.reason) : "No data returned"}`
            );
        }

        // Connection health
        if (connectionsResult.status === "fulfilled" && connectionsResult.value?.results) {
            const connections = connectionsResult.value.results;
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
                `## Recommended Actions\n- Check the Dead Letter Queue for failed documents\n- Use \`atlas-streams-manage\` with action 'modify-processor' to fix pipeline issues (processor must be stopped)\n- Use \`atlas-streams-manage\` with action 'start-processor' and resumeFromCheckpoint=false to restart from the beginning`
            );
        } else if (proc?.state === "STOPPED") {
            sections.push(
                `## Recommended Actions\n- Use \`atlas-streams-manage\` with action 'start-processor' to resume processing`
            );
        }

        return {
            content: formatUntrustedData(
                `Diagnostic report for processor '${processorName}' in workspace '${workspaceName}':`,
                sections.join("\n\n")
            ),
        };
    }

    private async getNetworking(
        projectId: string,
        cloudProvider: string | undefined,
        region: string | undefined
    ): Promise<CallToolResult> {
        const [privateLinkResult] = await Promise.allSettled([
            this.apiClient.listPrivateLinkConnections({
                params: { path: { groupId: projectId } },
            }),
        ]);

        const sections: string[] = [];

        if (cloudProvider && region) {
            try {
                const accountDetails = await this.apiClient.getAccountDetails({
                    params: {
                        path: { groupId: projectId },
                        query: { cloudProvider, regionName: region },
                    },
                });
                sections.push(
                    `## Account Details (${cloudProvider}/${region})\n${JSON.stringify(accountDetails, null, 2)}`
                );
            } catch {
                sections.push(`## Account Details\nCould not fetch account details for ${cloudProvider}/${region}.`);
            }
        }

        if (privateLinkResult.status === "fulfilled" && privateLinkResult.value?.results?.length) {
            const pls = privateLinkResult.value.results.map((pl) => ({
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
        };
    }
}
