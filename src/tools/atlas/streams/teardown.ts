import { z } from "zod";
import { StreamsToolBase } from "./streamsToolBase.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { OperationType, ToolArgs } from "../../tool.js";
import { AtlasArgs } from "../../args.js";
import { StreamsArgs } from "./streamsArgs.js";

const TeardownResource = z.enum(["processor", "connection", "workspace", "privatelink", "peering"]);

export class StreamsTeardownTool extends StreamsToolBase {
    static toolName = "atlas-streams-teardown";
    static operationType: OperationType = "delete";

    public description =
        "Delete Atlas Stream Processing resources. " +
        "Also use for 'remove my workspace', 'delete all processors', or 'clean up my streams environment'. " +
        "Performs basic safety checks before deletion: summarizes counts of processors and connections, " +
        "highlights connections referenced by processors where possible, and surfaces API errors if processors are still running when deletion is attempted. " +
        "Use `atlas-streams-discover` to review resources before deleting.";

    public argsShape = {
        projectId: AtlasArgs.projectId().describe(
            "Atlas project ID. Use atlas-list-projects to find project IDs if not available."
        ),
        resource: TeardownResource.describe(
            "What to delete. 'processor': stop first recommended. 'connection': ensure no processor references it. " +
                "'workspace': removes all contained connections and processors."
        ),
        workspaceName: StreamsArgs.workspaceName()
            .optional()
            .describe("Workspace name. Required for workspace, connection, and processor deletion."),
        resourceName: z.string().optional().describe("Name or ID of the specific resource to delete."),
    };

    protected override getConfirmationMessage(args: ToolArgs<typeof this.argsShape>): string {
        switch (args.resource) {
            case "workspace": {
                const workspace = this.requireWorkspaceName(args);
                return (
                    `You are about to delete workspace '${workspace}'. ` +
                    `This will permanently remove ALL connections and processors in this workspace. ` +
                    `This action cannot be undone. Proceed?`
                );
            }
            case "processor": {
                const workspace = this.requireWorkspaceName(args);
                const name = this.requireResourceName(args);
                return (
                    `You are about to delete processor '${name}' from workspace '${workspace}'. ` +
                    `If the processor is running, it will be stopped first. ` +
                    `All processor state and checkpoints will be permanently lost. Proceed?`
                );
            }
            case "connection": {
                const workspace = this.requireWorkspaceName(args);
                const name = this.requireResourceName(args);
                return (
                    `You are about to delete connection '${name}' from workspace '${workspace}'. ` +
                    `Any processors referencing this connection will fail. Proceed?`
                );
            }
            case "privatelink": {
                const name = this.requireResourceName(args);
                return `You are about to delete PrivateLink connection '${name}'. This cannot be undone. Proceed?`;
            }
            case "peering": {
                const name = this.requireResourceName(args);
                return `You are about to delete VPC peering connection '${name}'. This cannot be undone. Proceed?`;
            }
        }
    }

    protected async execute(args: ToolArgs<typeof this.argsShape>): Promise<CallToolResult> {
        switch (args.resource) {
            case "processor":
                return this.deleteProcessor(args);
            case "connection":
                return this.deleteConnection(args);
            case "workspace":
                return this.deleteWorkspace(args);
            case "privatelink":
                return this.deletePrivateLink(args);
            case "peering":
                return this.deletePeering(args);
            default:
                return {
                    content: [{ type: "text", text: `Unknown resource type: ${args.resource as string}` }],
                    isError: true,
                };
        }
    }

    private requireWorkspaceName(args: ToolArgs<typeof this.argsShape>): string {
        if (!args.workspaceName) {
            throw new Error("workspaceName is required for this deletion.");
        }
        return args.workspaceName;
    }

    private requireResourceName(args: ToolArgs<typeof this.argsShape>): string {
        if (!args.resourceName) {
            throw new Error("resourceName is required for this deletion.");
        }
        return args.resourceName;
    }

    private async deleteProcessor(args: ToolArgs<typeof this.argsShape>): Promise<CallToolResult> {
        const workspace = this.requireWorkspaceName(args);
        const name = this.requireResourceName(args);

        const processor = await this.apiClient.getStreamProcessor({
            params: { path: { groupId: args.projectId, tenantName: workspace, processorName: name } },
        });
        if (processor?.state === "STARTED") {
            await this.apiClient.stopStreamProcessor({
                params: { path: { groupId: args.projectId, tenantName: workspace, processorName: name } },
            });
        }

        await this.apiClient.deleteStreamProcessor({
            params: { path: { groupId: args.projectId, tenantName: workspace, processorName: name } },
        });

        return {
            content: [
                {
                    type: "text",
                    text: `Processor '${name}' deleted from workspace '${workspace}'. All state and checkpoints have been permanently removed.`,
                },
            ],
        };
    }

    private async deleteConnection(args: ToolArgs<typeof this.argsShape>): Promise<CallToolResult> {
        const workspace = this.requireWorkspaceName(args);
        const name = this.requireResourceName(args);

        // Safety: check if any processor references this connection
        try {
            const processors = await this.apiClient.getStreamProcessors({
                params: { path: { groupId: args.projectId, tenantName: workspace } },
            });
            const referencingProcessors = (processors?.results ?? []).filter((p) => {
                const referencedNames = StreamsToolBase.extractConnectionNames(p.pipeline ?? []);
                return referencedNames.has(name);
            });

            if (referencingProcessors.length > 0) {
                const names = referencingProcessors.map((p) => p.name).join(", ");
                const runningOnes = referencingProcessors.filter((p) => p.state === "STARTED");
                if (runningOnes.length > 0) {
                    return {
                        content: [
                            {
                                type: "text",
                                text:
                                    `Warning: Connection '${name}' is referenced by running processor(s): ${names}. ` +
                                    `Stop these processors first with \`atlas-streams-manage\` action 'stop-processor', then retry deletion.`,
                            },
                        ],
                        isError: true,
                    };
                }
            }
        } catch {
            // If we can't check processors, proceed with deletion anyway
        }

        await this.apiClient.deleteStreamConnection({
            params: { path: { groupId: args.projectId, tenantName: workspace, connectionName: name } },
        });

        return {
            content: [
                {
                    type: "text",
                    text:
                        `Connection '${name}' deletion initiated in workspace '${workspace}'. ` +
                        `Use \`atlas-streams-discover\` with action 'list-connections' to confirm when deletion is complete.`,
                },
            ],
        };
    }

    private async deleteWorkspace(args: ToolArgs<typeof this.argsShape>): Promise<CallToolResult> {
        const workspace = this.requireWorkspaceName(args);

        // Safety: summarize what will be deleted
        let impactNote = "";
        try {
            const [connectionsResult, processorsResult] = await Promise.allSettled([
                this.apiClient.listStreamConnections({
                    params: { path: { groupId: args.projectId, tenantName: workspace } },
                }),
                this.apiClient.getStreamProcessors({
                    params: { path: { groupId: args.projectId, tenantName: workspace } },
                }),
            ]);

            const connectionCount =
                connectionsResult.status === "fulfilled" ? (connectionsResult.value?.results?.length ?? 0) : 0;
            const processorCount =
                processorsResult.status === "fulfilled" ? (processorsResult.value?.results?.length ?? 0) : 0;

            if (connectionCount > 0 || processorCount > 0) {
                impactNote = ` This will also remove ${processorCount} processor(s) and ${connectionCount} connection(s).`;
            }
        } catch {
            // If we can't get counts, proceed anyway
        }

        await this.apiClient.deleteStreamWorkspace({
            params: { path: { groupId: args.projectId, tenantName: workspace } },
        });

        return {
            content: [
                {
                    type: "text",
                    text:
                        `Workspace '${workspace}' deletion initiated.${impactNote} ` +
                        `Use \`atlas-streams-discover\` with action 'list-workspaces' to confirm when deletion is complete.`,
                },
            ],
        };
    }

    private async deletePrivateLink(args: ToolArgs<typeof this.argsShape>): Promise<CallToolResult> {
        const id = this.requireResourceName(args);
        await this.apiClient.deletePrivateLinkConnection({
            params: { path: { groupId: args.projectId, connectionId: id } },
        });

        return {
            content: [
                {
                    type: "text",
                    text:
                        `PrivateLink connection '${id}' deletion initiated. ` +
                        `Use \`atlas-streams-discover\` with action 'get-networking' to confirm when deletion is complete.`,
                },
            ],
        };
    }

    private async deletePeering(args: ToolArgs<typeof this.argsShape>): Promise<CallToolResult> {
        const id = this.requireResourceName(args);
        await this.apiClient.deleteVpcPeeringConnection({
            params: { path: { groupId: args.projectId, id: id } },
        });

        return {
            content: [
                {
                    type: "text",
                    text: `VPC peering connection '${id}' deletion initiated.`,
                },
            ],
        };
    }
}
