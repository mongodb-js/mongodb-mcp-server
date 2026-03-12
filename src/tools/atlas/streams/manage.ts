import { z } from "zod";
import { StreamsToolBase } from "./streamsToolBase.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { OperationType, ToolArgs } from "../../tool.js";
import { AtlasArgs } from "../../args.js";
import { StreamsArgs } from "./streamsArgs.js";

const ManageAction = z.enum([
    "start-processor",
    "stop-processor",
    "modify-processor",
    "update-workspace",
    "update-connection",
    "accept-peering",
    "reject-peering",
]);

export class StreamsManageTool extends StreamsToolBase {
    static toolName = "atlas-streams-manage";
    static operationType: OperationType = "update";

    public description =
        "Manage Atlas Stream Processing resources: start/stop processors, modify pipelines, update configurations. " +
        "Also use for 'change the pipeline', 'scale up my processor', or 'update my workspace tier'. " +
        "Common workflow: action='stop-processor' → action='modify-processor' → action='start-processor'. " +
        "Use `atlas-streams-discover` with action 'inspect-processor' to check state before managing.";

    public argsShape = {
        projectId: AtlasArgs.projectId().describe(
            "Atlas project ID. Use atlas-list-projects to find project IDs if not available."
        ),
        workspaceName: StreamsArgs.workspaceName().describe("Workspace name containing the resource to manage."),
        action: ManageAction.describe(
            "Action to perform. Processor must be stopped before 'modify-processor'. " +
                "Use 'start-processor' to begin or resume processing, 'stop-processor' to pause."
        ),
        resourceName: z
            .string()
            .optional()
            .describe("Processor or connection name. Required for processor and connection actions."),

        // start-processor options
        tier: z
            .string()
            .optional()
            .describe(
                "Override processing tier for this run (SP2, SP5, SP10, SP30, SP50). " +
                    "Must not exceed the workspace's max tier. Use `atlas-streams-discover` action='inspect-workspace' to check. " +
                    "Only for 'start-processor'."
            ),
        resumeFromCheckpoint: z
            .boolean()
            .optional()
            .describe(
                "Resume from last checkpoint on start. Default: true. " +
                    "Set false to reprocess from beginning (drops accumulated window state). Only for 'start-processor'."
            ),
        startAtOperationTime: z
            .string()
            .optional()
            .describe("ISO 8601 timestamp to resume from. Only for 'start-processor'."),

        // modify-processor options
        pipeline: z
            .array(z.record(z.unknown()))
            .optional()
            .describe(
                "New aggregation pipeline. Only for 'modify-processor'. Processor must be stopped first. " +
                    "If changing a window stage interval, the processor must be restarted with resumeFromCheckpoint=false."
            ),
        dlq: z
            .object({
                connectionName: z.string(),
                db: z.string(),
                coll: z.string(),
            })
            .optional()
            .describe("New DLQ configuration. Only for 'modify-processor'."),
        newName: z.string().optional().describe("Rename processor. Only for 'modify-processor'."),

        // update-workspace options
        newRegion: z
            .string()
            .optional()
            .describe(
                "New region for workspace. Only for 'update-workspace'. Use Atlas region names (e.g. AWS: 'VIRGINIA_USA', Azure: 'eastus2', GCP: 'US_CENTRAL1')."
            ),
        newTier: z
            .string()
            .optional()
            .describe("New default tier for workspace (SP2, SP5, SP10, SP30, SP50). Only for 'update-workspace'."),

        // update-connection options
        connectionConfig: z
            .record(z.unknown())
            .optional()
            .describe(
                "Updated connection configuration. Only for 'update-connection'. " +
                    "Note: networking config cannot be modified after creation — to change networking, delete and recreate the connection."
            ),

        // peering options
        peeringId: z
            .string()
            .optional()
            .describe("VPC peering connection ID. Required for 'accept-peering' and 'reject-peering'."),
        requesterAccountId: z
            .string()
            .optional()
            .describe("AWS account ID of the peering requester. Required for 'accept-peering'."),
        requesterVpcId: z
            .string()
            .optional()
            .describe("VPC ID of the peering requester. Required for 'accept-peering'."),
    };

    protected async execute(args: ToolArgs<typeof this.argsShape>): Promise<CallToolResult> {
        switch (args.action) {
            case "start-processor":
                return this.startProcessor(args);
            case "stop-processor":
                return this.stopProcessor(args);
            case "modify-processor":
                return this.modifyProcessor(args);
            case "update-workspace":
                return this.updateWorkspace(args);
            case "update-connection":
                return this.updateConnection(args);
            case "accept-peering":
                return this.acceptPeering(args);
            case "reject-peering":
                return this.rejectPeering(args);
            default:
                return {
                    content: [{ type: "text", text: `Unknown action: ${args.action as string}` }],
                    isError: true,
                };
        }
    }

    protected override getConfirmationMessage(args: ToolArgs<typeof this.argsShape>): string {
        switch (args.action) {
            case "start-processor": {
                const checkpointWarning =
                    args.resumeFromCheckpoint === false
                        ? ` WARNING: resumeFromCheckpoint is false — all accumulated window state will be permanently lost.`
                        : "";
                return (
                    `You are about to start processor '${args.resourceName}' in workspace '${args.workspaceName}'. ` +
                    `Starting a processor will begin billing for stream processing usage based on the workspace tier.${checkpointWarning} Proceed?`
                );
            }
            case "stop-processor":
                return `You are about to stop processor '${args.resourceName}' in workspace '${args.workspaceName}'. In-flight data will complete processing. Proceed?`;
            case "modify-processor":
                return `You are about to modify processor '${args.resourceName}' in workspace '${args.workspaceName}'. This may affect pipeline behavior. Proceed?`;
            case "update-workspace":
                return `You are about to update workspace '${args.workspaceName}'. Proceed?`;
            case "update-connection":
                return `You are about to update connection '${args.resourceName}' in workspace '${args.workspaceName}'. Proceed?`;
            case "accept-peering":
                return `You are about to accept VPC peering connection '${args.peeringId}'. Proceed?`;
            case "reject-peering":
                return `You are about to reject VPC peering connection '${args.peeringId}'. This cannot be undone. Proceed?`;
        }
    }

    private requireResourceName(resourceName: string | undefined, context: string): string {
        if (!resourceName) {
            throw new Error(`resourceName is required for '${context}'.`);
        }
        return resourceName;
    }

    private async startProcessor(args: ToolArgs<typeof this.argsShape>): Promise<CallToolResult> {
        const name = this.requireResourceName(args.resourceName, "start-processor");

        const processor = await this.apiClient.getStreamProcessor({
            params: { path: { groupId: args.projectId, tenantName: args.workspaceName, processorName: name } },
        });
        if (processor?.state === "STARTED") {
            return {
                content: [
                    {
                        type: "text",
                        text: `Processor '${name}' is already running. Use action 'stop-processor' first if you want to restart it.`,
                    },
                ],
                isError: true,
            };
        }

        if (args.tier) {
            const tierOrder = ["SP2", "SP5", "SP10", "SP30", "SP50"];
            try {
                const ws = await this.apiClient.getStreamWorkspace({
                    params: { path: { groupId: args.projectId, tenantName: args.workspaceName } },
                });
                const maxTier = ws?.streamConfig?.maxTierSize;
                if (maxTier && tierOrder.indexOf(args.tier) > tierOrder.indexOf(maxTier)) {
                    return {
                        content: [
                            {
                                type: "text",
                                text:
                                    `Cannot start processor with tier '${args.tier}' — workspace '${args.workspaceName}' has a maximum tier of '${maxTier}'.\n\n` +
                                    `Options:\n` +
                                    `1. Use a tier ≤ ${maxTier}\n` +
                                    `2. Raise the workspace max tier first with \`atlas-streams-manage\` action='update-workspace' newTier='${args.tier}'`,
                            },
                        ],
                        isError: true,
                    };
                }
            } catch {
                // Soft check — proceed anyway if we can't fetch workspace
            }
        }

        const hasStartOptions =
            args.tier !== undefined ||
            args.resumeFromCheckpoint !== undefined ||
            args.startAtOperationTime !== undefined;

        if (hasStartOptions) {
            const startBody: Record<string, unknown> = {};
            if (args.tier !== undefined) startBody.tier = args.tier;
            if (args.resumeFromCheckpoint !== undefined) startBody.resumeFromCheckpoint = args.resumeFromCheckpoint;
            if (args.startAtOperationTime !== undefined) startBody.startAtOperationTime = args.startAtOperationTime;

            await this.apiClient.startStreamProcessorWith({
                params: { path: { groupId: args.projectId, tenantName: args.workspaceName, processorName: name } },
                body: startBody as never,
            });
        } else {
            await this.apiClient.startStreamProcessor({
                params: { path: { groupId: args.projectId, tenantName: args.workspaceName, processorName: name } },
            });
        }

        const checkpointNote =
            args.resumeFromCheckpoint === false
                ? " Starting from the beginning (no checkpoint resume)."
                : " Resuming from last checkpoint.";

        return {
            content: [
                {
                    type: "text",
                    text:
                        `Processor '${name}' started in workspace '${args.workspaceName}'.${checkpointNote}\n\n` +
                        `Note: Billing for stream processing usage is now active for this processor.\n\n` +
                        `Use \`atlas-streams-discover\` with action 'diagnose-processor' to monitor health. ` +
                        `Use \`atlas-streams-manage\` with action 'stop-processor' to stop billing.`,
                },
            ],
        };
    }

    private async stopProcessor(args: ToolArgs<typeof this.argsShape>): Promise<CallToolResult> {
        const name = this.requireResourceName(args.resourceName, "stop-processor");

        const processor = await this.apiClient.getStreamProcessor({
            params: { path: { groupId: args.projectId, tenantName: args.workspaceName, processorName: name } },
        });
        if (processor?.state === "STOPPED" || processor?.state === "CREATED") {
            return {
                content: [
                    {
                        type: "text",
                        text: `Processor '${name}' is already stopped (state: ${processor.state}). No action needed.`,
                    },
                ],
            };
        }

        await this.apiClient.stopStreamProcessor({
            params: { path: { groupId: args.projectId, tenantName: args.workspaceName, processorName: name } },
        });

        return {
            content: [
                {
                    type: "text",
                    text:
                        `Processor '${name}' stopped. State preserved for 45 days.\n\n` +
                        `Use action 'modify-processor' to change its pipeline, or action 'start-processor' to resume.`,
                },
            ],
        };
    }

    private async modifyProcessor(args: ToolArgs<typeof this.argsShape>): Promise<CallToolResult> {
        const name = this.requireResourceName(args.resourceName, "modify-processor");

        const processor = await this.apiClient.getStreamProcessor({
            params: { path: { groupId: args.projectId, tenantName: args.workspaceName, processorName: name } },
        });
        if (processor?.state === "STARTED") {
            return {
                content: [
                    {
                        type: "text",
                        text: `Processor '${name}' must be stopped before modifying. Use action 'stop-processor' first.`,
                    },
                ],
                isError: true,
            };
        }

        const body: Record<string, unknown> = {};
        if (args.pipeline) body.pipeline = args.pipeline;
        if (args.newName) body.name = args.newName;
        if (args.dlq) body.options = { dlq: args.dlq };

        if (Object.keys(body).length === 0) {
            return {
                content: [
                    {
                        type: "text",
                        text: "No modifications specified. Provide at least one of: pipeline, dlq, or newName.",
                    },
                ],
                isError: true,
            };
        }

        await this.apiClient.updateStreamProcessor({
            params: { path: { groupId: args.projectId, tenantName: args.workspaceName, processorName: name } },
            body: body as never,
        });

        const changes = Object.keys(body).join(", ");
        return {
            content: [
                {
                    type: "text",
                    text:
                        `Processor '${name}' modified (changed: ${changes}).\n\n` +
                        `Use action 'start-processor' to resume processing with the updated configuration.`,
                },
            ],
        };
    }

    private async updateWorkspace(args: ToolArgs<typeof this.argsShape>): Promise<CallToolResult> {
        const body: Record<string, unknown> = {};
        if (args.newRegion) {
            body.dataProcessRegion = { region: args.newRegion };
        }
        if (args.newTier) {
            body.streamConfig = { tier: args.newTier };
        }

        if (Object.keys(body).length === 0) {
            return {
                content: [
                    {
                        type: "text",
                        text: "No updates specified. Provide at least one of: newRegion or newTier.",
                    },
                ],
                isError: true,
            };
        }

        await this.apiClient.updateStreamWorkspace({
            params: { path: { groupId: args.projectId, tenantName: args.workspaceName } },
            body: body as never,
        });

        return {
            content: [
                {
                    type: "text",
                    text: `Workspace '${args.workspaceName}' updated. Use \`atlas-streams-discover\` with action 'inspect-workspace' to verify changes.`,
                },
            ],
        };
    }

    private async updateConnection(args: ToolArgs<typeof this.argsShape>): Promise<CallToolResult> {
        const name = this.requireResourceName(args.resourceName, "update-connection");

        if (!args.connectionConfig) {
            throw new Error("connectionConfig is required to update a connection.");
        }

        await this.apiClient.updateStreamConnection({
            params: { path: { groupId: args.projectId, tenantName: args.workspaceName, connectionName: name } },
            body: args.connectionConfig as never,
        });

        return {
            content: [
                {
                    type: "text",
                    text: `Connection '${name}' updated in workspace '${args.workspaceName}'.`,
                },
            ],
        };
    }

    private async acceptPeering(args: ToolArgs<typeof this.argsShape>): Promise<CallToolResult> {
        if (!args.peeringId) throw new Error("peeringId is required to accept a VPC peering connection.");
        if (!args.requesterAccountId) throw new Error("requesterAccountId is required to accept VPC peering.");
        if (!args.requesterVpcId) throw new Error("requesterVpcId is required to accept VPC peering.");

        const peeringId = args.peeringId;
        const requesterAccountId = args.requesterAccountId;
        const requesterVpcId = args.requesterVpcId;

        await this.apiClient.acceptVpcPeeringConnection({
            params: { path: { groupId: args.projectId, id: peeringId } },
            body: {
                requesterAccountId,
                requesterVpcId,
            },
        });

        return {
            content: [
                {
                    type: "text",
                    text: `VPC peering connection '${args.peeringId}' accepted. It may take a few minutes to become active.`,
                },
            ],
        };
    }

    private async rejectPeering(args: ToolArgs<typeof this.argsShape>): Promise<CallToolResult> {
        if (!args.peeringId) throw new Error("peeringId is required to reject a VPC peering connection.");

        await this.apiClient.rejectVpcPeeringConnection({
            params: { path: { groupId: args.projectId, id: args.peeringId } },
        });

        return {
            content: [
                {
                    type: "text",
                    text: `VPC peering connection '${args.peeringId}' rejected.`,
                },
            ],
        };
    }
}
