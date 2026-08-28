import { z } from "zod";
import { StreamsToolBase } from "../../streams/streamsToolBase.js";
import type { IAtlasConfig } from "../../atlasTool.js";
import type { CallToolResult, OperationType, ToolExecutionContext, ToolRequest } from "@mongodb-js/mcp-types";
import { LogId, requestIdAttr, type ToolArgs } from "@mongodb-js/mcp-core";
import { AtlasArgs } from "../../args.js";
import { StreamsArgs } from "../../streams/streamsArgs.js";

const TeardownResource = z.enum(["processor", "connection", "workspace", "privatelink", "peering"]);

export const TeardownOutputSchema = z.object({
    resource: TeardownResource.describe("Which resource deletion completed or was initiated"),
    processorsRemoved: z
        .number()
        .int()
        .nonnegative()
        .optional()
        .describe("Processors removed as part of workspace deletion (when inventory was available)"),
    connectionsRemoved: z
        .number()
        .int()
        .nonnegative()
        .optional()
        .describe("Connections removed as part of workspace deletion (when inventory was available)"),
});

export type TeardownOutput = z.infer<typeof TeardownOutputSchema>;

export class StreamsTeardownTool extends StreamsToolBase {
    static toolName = "atlas-streams-teardown";
    static operationType: OperationType = "delete";

    public description =
        "Delete Atlas Stream Processing resources. " +
        "Also use for 'remove my workspace', 'disconnect a source', 'delete all processors', or 'clean up my streams environment'. " +
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
        resourceName: StreamsArgs.resourceName().optional().describe("Name or ID of the specific resource to delete."),
    };

    public override outputSchema = TeardownOutputSchema.shape;

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

    protected async execute(
        args: ToolArgs<typeof this.argsShape>,
        { request }: ToolExecutionContext
    ): Promise<CallToolResult> {
        switch (args.resource) {
            case "processor":
                return this.deleteProcessor(args, request);
            case "connection":
                return this.deleteConnection(args, request);
            case "workspace":
                return this.deleteWorkspace(args, request);
            case "privatelink":
                return this.deletePrivateLink(args, request);
            case "peering":
                return this.deletePeering(args, request);
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

    private async deleteProcessor(
        args: ToolArgs<typeof this.argsShape>,
        request: ToolRequest<IAtlasConfig>
    ): Promise<CallToolResult> {
        const workspace = this.requireWorkspaceName(args);
        const name = this.requireResourceName(args);

        try {
            const processor = await this.server.apiClient.getStreamProcessor(
                {
                    params: { path: { groupId: args.projectId, tenantName: workspace, processorName: name } },
                },
                request
            );
            if (processor?.state === "STARTED") {
                await this.server.apiClient.stopStreamProcessor(
                    {
                        params: { path: { groupId: args.projectId, tenantName: workspace, processorName: name } },
                    },
                    request
                );
            }
        } catch (error: unknown) {
            // Processor may be in error state — proceed with delete attempt
            this.server.logger.debug({
                id: LogId.streamsProcessorStateLookupFailure,
                context: "streams-teardown",
                message: `Failed to get processor state before delete: ${error instanceof Error ? error.message : String(error)}`,
                attributes: { ...requestIdAttr(request?.headers) },
            });
        }

        await this.server.apiClient.deleteStreamProcessor(
            {
                params: { path: { groupId: args.projectId, tenantName: workspace, processorName: name } },
            },
            request
        );

        return {
            content: [
                {
                    type: "text",
                    text: `Processor '${name}' deleted from workspace '${workspace}'. All state and checkpoints have been permanently removed.`,
                },
            ],
            structuredContent: { resource: "processor" },
        };
    }

    private async deleteConnection(
        args: ToolArgs<typeof this.argsShape>,
        request: ToolRequest<IAtlasConfig>
    ): Promise<CallToolResult> {
        const workspace = this.requireWorkspaceName(args);
        const name = this.requireResourceName(args);

        // Safety: check if any processor references this connection
        try {
            const processors = await this.server.apiClient.getStreamProcessors(
                {
                    params: { path: { groupId: args.projectId, tenantName: workspace } },
                },
                request
            );
            const referencingProcessors = (processors?.results ?? []).filter((p) => {
                const referencedNames = StreamsToolBase.extractConnectionNames(p.pipeline ?? []);
                return referencedNames.has(name);
            });

            if (referencingProcessors.length > 0) {
                const runningOnes = referencingProcessors.filter((p) => p.state === "STARTED");
                if (runningOnes.length > 0) {
                    const names = runningOnes.map((p) => p.name).join(", ");
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

        await this.server.apiClient.deleteStreamConnection(
            {
                params: { path: { groupId: args.projectId, tenantName: workspace, connectionName: name } },
            },
            request
        );

        return {
            content: [
                {
                    type: "text",
                    text:
                        `Connection '${name}' deletion initiated in workspace '${workspace}'. ` +
                        `Use \`atlas-streams-discover\` with action 'list-connections' to confirm when deletion is complete.`,
                },
            ],
            structuredContent: { resource: "connection" },
        };
    }

    private async deleteWorkspace(
        args: ToolArgs<typeof this.argsShape>,
        request: ToolRequest<IAtlasConfig>
    ): Promise<CallToolResult> {
        const workspace = this.requireWorkspaceName(args);

        // Safety: summarize what will be deleted
        let impactNote = "";
        const structuredContent: TeardownOutput = { resource: "workspace" };
        try {
            const [connectionsResult, processorsResult] = await Promise.allSettled([
                this.server.apiClient.listStreamConnections(
                    {
                        params: { path: { groupId: args.projectId, tenantName: workspace } },
                    },
                    request
                ),
                this.server.apiClient.getStreamProcessors(
                    {
                        params: { path: { groupId: args.projectId, tenantName: workspace } },
                    },
                    request
                ),
            ]);

            const connectionCount =
                connectionsResult.status === "fulfilled" ? (connectionsResult.value?.results?.length ?? 0) : 0;
            const processorCount =
                processorsResult.status === "fulfilled" ? (processorsResult.value?.results?.length ?? 0) : 0;

            if (connectionsResult.status === "fulfilled") {
                structuredContent.connectionsRemoved = connectionCount;
            }
            if (processorsResult.status === "fulfilled") {
                structuredContent.processorsRemoved = processorCount;
            }

            if (connectionCount > 0 || processorCount > 0) {
                impactNote = ` This will also remove ${processorCount} processor(s) and ${connectionCount} connection(s).`;
            }
        } catch {
            // If we can't get counts, proceed anyway
        }

        await this.server.apiClient.deleteStreamWorkspace(
            {
                params: { path: { groupId: args.projectId, tenantName: workspace } },
            },
            request
        );

        return {
            content: [
                {
                    type: "text",
                    text:
                        `Workspace '${workspace}' deletion initiated.${impactNote} ` +
                        `Use \`atlas-streams-discover\` with action 'list-workspaces' to confirm when deletion is complete.`,
                },
            ],
            structuredContent,
        };
    }

    private async deletePrivateLink(
        args: ToolArgs<typeof this.argsShape>,
        request: ToolRequest<IAtlasConfig>
    ): Promise<CallToolResult> {
        const id = this.requireResourceName(args);
        await this.server.apiClient.deletePrivateLinkConnection(
            {
                params: { path: { groupId: args.projectId, connectionId: id } },
            },
            request
        );

        return {
            content: [
                {
                    type: "text",
                    text:
                        `PrivateLink connection '${id}' deletion initiated. ` +
                        `Use \`atlas-streams-discover\` with action 'get-networking' to confirm when deletion is complete.`,
                },
            ],
            structuredContent: { resource: "privatelink" },
        };
    }

    private async deletePeering(
        args: ToolArgs<typeof this.argsShape>,
        request: ToolRequest<IAtlasConfig>
    ): Promise<CallToolResult> {
        const id = this.requireResourceName(args);
        await this.server.apiClient.deleteVpcPeeringConnection(
            {
                params: { path: { groupId: args.projectId, id: id } },
            },
            request
        );

        return {
            content: [
                {
                    type: "text",
                    text: `VPC peering connection '${id}' deletion initiated.`,
                },
            ],
            structuredContent: { resource: "peering" },
        };
    }
}
