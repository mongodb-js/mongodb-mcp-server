import { z } from "zod";
import { StreamsToolBase } from "./streamsToolBase.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { OperationType, ToolArgs } from "../../tool.js";
import { AtlasArgs } from "../../args.js";
import { ConnectionConfig, StreamsArgs } from "./streamsArgs.js";
import { rejectInvalidConnectionConfig } from "./connectionConfigs.js";
import { LogId } from "../../../common/logging/index.js";

const ConnectionTypeEnum = z.enum([
    "Kafka",
    "Cluster",
    "S3",
    "Https",
    "AWSKinesisDataStreams",
    "AWSLambda",
    "SchemaRegistry",
    "Sample",
]);

const StartProcessorOp = z.object({
    action: z.literal("start-processor"),
    resourceName: z.string().describe("Processor name. Required."),
    tier: z
        .enum(["SP2", "SP5", "SP10", "SP30", "SP50"])
        .optional()
        .describe(
            "Override processing tier for this run. Must not exceed the workspace's max tier. " +
                "Use `atlas-streams-discover` action='inspect-workspace' to check."
        ),
    resumeFromCheckpoint: z
        .boolean()
        .optional()
        .describe(
            "Resume from last checkpoint on start. Default: true. " +
                "Set false to reprocess from beginning (drops accumulated window state)."
        ),
    startAtOperationTime: z.string().optional().describe("ISO 8601 timestamp to resume from."),
});

const StopProcessorOp = z.object({
    action: z.literal("stop-processor"),
    resourceName: z.string().describe("Processor name. Required."),
});

const ModifyProcessorOp = z.object({
    action: z.literal("modify-processor"),
    resourceName: z.string().describe("Processor name. Required. Processor must be stopped first."),
    pipeline: z
        .array(z.record(z.string(), z.unknown()))
        .optional()
        .describe(
            "New pipeline stages, e.g. [{$source: {connectionName: 'src'}}, {$merge: {into: {connectionName: 'dest', db: 'db', coll: 'coll'}}}]. " +
                "If changing a window stage interval, the processor must be restarted with resumeFromCheckpoint=false."
        ),
    dlq: z
        .object({
            connectionName: z.string(),
            db: z.string(),
            coll: z.string(),
        })
        .optional()
        .describe("New DLQ configuration."),
    newName: z.string().optional().describe("Rename processor."),
});

const UpdateWorkspaceOp = z.object({
    action: z.literal("update-workspace"),
    newRegion: z
        .string()
        .optional()
        .describe(
            "New region for workspace. Use Atlas region names " +
                "(AWS: 'VIRGINIA_USA', Azure: 'eastus2', GCP: 'US_CENTRAL1')."
        ),
    newTier: z.enum(["SP2", "SP5", "SP10", "SP30", "SP50"]).optional().describe("New default tier for workspace."),
});

const UpdateConnectionOp = z.object({
    action: z.literal("update-connection"),
    resourceName: z.string().describe("Connection name. Required."),
    connectionConfig: ConnectionConfig.describe(
        "Updated connection configuration. Provide only the fields to change. " +
            "Note: networking config and connection type cannot be modified after creation — to change these, delete and recreate the connection."
    ),
    connectionType: ConnectionTypeEnum.optional().describe(
        "Connection type. Optional — if omitted, the tool looks it up from the existing connection. " +
            "Provide only when the server cannot infer it."
    ),
});

const AcceptPeeringOp = z.object({
    action: z.literal("accept-peering"),
    peeringId: z.string().describe("VPC peering connection ID. Required."),
    requesterAccountId: z.string().describe("AWS account ID of the peering requester. Required."),
    requesterVpcId: z.string().describe("VPC ID of the peering requester. Required."),
});

const RejectPeeringOp = z.object({
    action: z.literal("reject-peering"),
    peeringId: z.string().describe("VPC peering connection ID. Required."),
});

const ManageOperation = z.discriminatedUnion("action", [
    StartProcessorOp,
    StopProcessorOp,
    ModifyProcessorOp,
    UpdateWorkspaceOp,
    UpdateConnectionOp,
    AcceptPeeringOp,
    RejectPeeringOp,
]);

type ManageOperationArgs = z.infer<typeof ManageOperation>;

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
        workspaceName: StreamsArgs.workspaceName().describe(
            "Workspace name containing the resource to manage. For peering actions, any workspace in the project (peering is project-level)."
        ),
        // Note: Although it is not required to wrap the discriminated union in
        // an array here because we only expect exactly one operation to be
        // provided here, we unfortunately cannot use the discriminatedUnion as
        // is because Cursor is unable to construct payload for tool calls where
        // the input schema contains a discriminated union without such
        // wrapping. This is a workaround for enabling the tool calls on Cursor.
        operation: z
            .array(ManageOperation)
            .describe(
                "The management operation to perform, with its action-specific parameters. " +
                    "Exactly one operation per call. Supported actions: " +
                    "'start-processor' — begin/resume processing (requires resourceName). " +
                    "'stop-processor' — pause processing (requires resourceName). " +
                    "'modify-processor' — change pipeline, DLQ, or rename (requires resourceName; processor must be stopped first). " +
                    "'update-workspace' — change workspace tier or region. " +
                    "'update-connection' — update connection config (requires resourceName and connectionConfig). " +
                    "'accept-peering' — accept a VPC peering request. " +
                    "'reject-peering' — reject a VPC peering request."
            ),
    };

    private getOperation(args: ToolArgs<typeof this.argsShape>): ManageOperationArgs {
        const op = args.operation[0];
        if (!op) {
            throw new Error(
                "No operation provided. Expected exactly one operation entry with an 'action' and its parameters."
            );
        }
        return op;
    }

    protected async execute(args: ToolArgs<typeof this.argsShape>): Promise<CallToolResult> {
        const op = this.getOperation(args);
        switch (op.action) {
            case "start-processor":
                return this.startProcessor(args.projectId, args.workspaceName, op);
            case "stop-processor":
                return this.stopProcessor(args.projectId, args.workspaceName, op);
            case "modify-processor":
                return this.modifyProcessor(args.projectId, args.workspaceName, op);
            case "update-workspace":
                return this.updateWorkspace(args.projectId, args.workspaceName, op);
            case "update-connection":
                return this.updateConnection(args.projectId, args.workspaceName, op);
            case "accept-peering":
                return this.acceptPeering(args.projectId, op);
            case "reject-peering":
                return this.rejectPeering(args.projectId, op);
        }
    }

    protected override getConfirmationMessage(args: ToolArgs<typeof this.argsShape>): string {
        const op = this.getOperation(args);
        switch (op.action) {
            case "start-processor": {
                const checkpointWarning =
                    op.resumeFromCheckpoint === false
                        ? ` WARNING: resumeFromCheckpoint is false — all accumulated window state will be permanently lost.`
                        : "";
                return (
                    `You are about to start processor '${op.resourceName}' in workspace '${args.workspaceName}'. ` +
                    `Starting a processor will begin billing for stream processing usage based on the workspace tier.${checkpointWarning} Proceed?`
                );
            }
            case "stop-processor":
                return `You are about to stop processor '${op.resourceName}' in workspace '${args.workspaceName}'. In-flight data will complete processing. Proceed?`;
            case "modify-processor":
                return `You are about to modify processor '${op.resourceName}' in workspace '${args.workspaceName}'. This may affect pipeline behavior. Proceed?`;
            case "update-workspace":
                return `You are about to update workspace '${args.workspaceName}'. Proceed?`;
            case "update-connection":
                return `You are about to update connection '${op.resourceName}' in workspace '${args.workspaceName}'. Proceed?`;
            case "accept-peering":
                return `You are about to accept VPC peering connection '${op.peeringId}'. Proceed?`;
            case "reject-peering":
                return `You are about to reject VPC peering connection '${op.peeringId}'. This cannot be undone. Proceed?`;
        }
    }

    private async startProcessor(
        projectId: string,
        workspaceName: string,
        op: z.infer<typeof StartProcessorOp>
    ): Promise<CallToolResult> {
        const name = op.resourceName;

        const processor = await this.apiClient.getStreamProcessor({
            params: { path: { groupId: projectId, tenantName: workspaceName, processorName: name } },
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

        if (op.tier) {
            const tierOrder = ["SP2", "SP5", "SP10", "SP30", "SP50"];
            try {
                const ws = await this.apiClient.getStreamWorkspace({
                    params: { path: { groupId: projectId, tenantName: workspaceName } },
                });
                const maxTier = ws?.streamConfig?.maxTierSize;
                if (maxTier && tierOrder.indexOf(op.tier) > tierOrder.indexOf(maxTier)) {
                    return {
                        content: [
                            {
                                type: "text",
                                text:
                                    `Cannot start processor with tier '${op.tier}' — workspace '${workspaceName}' has a maximum tier of '${maxTier}'.\n\n` +
                                    `Options:\n` +
                                    `1. Use a tier ≤ ${maxTier}\n` +
                                    `2. Raise the workspace max tier first with \`atlas-streams-manage\` action='update-workspace' newTier='${op.tier}'`,
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
            op.tier !== undefined || op.resumeFromCheckpoint !== undefined || op.startAtOperationTime !== undefined;

        if (hasStartOptions) {
            const startBody: {
                tier?: "SP2" | "SP5" | "SP10" | "SP30" | "SP50";
                resumeFromCheckpoint?: boolean;
                startAtOperationTime?: string;
            } = {};
            if (op.tier !== undefined) startBody.tier = op.tier;
            if (op.resumeFromCheckpoint !== undefined) startBody.resumeFromCheckpoint = op.resumeFromCheckpoint;
            if (op.startAtOperationTime !== undefined) startBody.startAtOperationTime = op.startAtOperationTime;

            await this.apiClient.startStreamProcessorWith({
                params: { path: { groupId: projectId, tenantName: workspaceName, processorName: name } },
                // The Atlas OpenAPI schema types `body` as a literal enum-heavy object; our
                // validated tier/checkpoint/timestamp values are structurally compatible but
                // narrowing each field to its literal union buys nothing here.
                body: startBody as never,
            });
        } else {
            await this.apiClient.startStreamProcessor({
                params: { path: { groupId: projectId, tenantName: workspaceName, processorName: name } },
            });
        }

        const checkpointNote =
            op.resumeFromCheckpoint === false
                ? " Starting from the beginning (no checkpoint resume)."
                : " Resuming from last checkpoint.";

        return {
            content: [
                {
                    type: "text",
                    text:
                        `Processor '${name}' started in workspace '${workspaceName}'.${checkpointNote}\n\n` +
                        `Note: Billing for stream processing usage is now active for this processor.\n\n` +
                        `Use \`atlas-streams-discover\` with action 'diagnose-processor' to monitor health. ` +
                        `Use \`atlas-streams-manage\` with action 'stop-processor' to stop billing.`,
                },
            ],
        };
    }

    private async stopProcessor(
        projectId: string,
        workspaceName: string,
        op: z.infer<typeof StopProcessorOp>
    ): Promise<CallToolResult> {
        const name = op.resourceName;

        try {
            const processor = await this.apiClient.getStreamProcessor({
                params: { path: { groupId: projectId, tenantName: workspaceName, processorName: name } },
            });
            if (processor?.state === "STOPPED" || processor?.state === "CREATED") {
                return {
                    content: [
                        {
                            type: "text",
                            text: `Processor '${name}' is not running (state: ${processor.state}). No action needed.`,
                        },
                    ],
                };
            }
        } catch (error: unknown) {
            // Processor may be in error state — proceed with stop attempt
            this.session.logger.debug({
                id: LogId.streamsProcessorStateLookupFailure,
                context: "streams-manage",
                message: `Failed to get processor state before stop: ${error instanceof Error ? error.message : String(error)}`,
            });
        }

        await this.apiClient.stopStreamProcessor({
            params: { path: { groupId: projectId, tenantName: workspaceName, processorName: name } },
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

    private async modifyProcessor(
        projectId: string,
        workspaceName: string,
        op: z.infer<typeof ModifyProcessorOp>
    ): Promise<CallToolResult> {
        const name = op.resourceName;

        const processor = await this.apiClient.getStreamProcessor({
            params: { path: { groupId: projectId, tenantName: workspaceName, processorName: name } },
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

        const body: {
            pipeline?: Record<string, unknown>[];
            name?: string;
            options?: { dlq: { connectionName: string; db: string; coll: string } };
        } = {};
        if (op.pipeline) body.pipeline = op.pipeline;
        if (op.newName) body.name = op.newName;
        if (op.dlq) body.options = { dlq: op.dlq };

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
            params: { path: { groupId: projectId, tenantName: workspaceName, processorName: name } },
            // Atlas OpenAPI `pipeline` is typed as a tightly indexed object union our
            // generic `Record<string, unknown>` pipeline stages can't satisfy.
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

    private async updateWorkspace(
        projectId: string,
        workspaceName: string,
        op: z.infer<typeof UpdateWorkspaceOp>
    ): Promise<CallToolResult> {
        const body: {
            cloudProvider?: string;
            region?: string;
            streamConfig?: { tier: string };
        } = {};
        if (op.newRegion) {
            // The Atlas API requires cloudProvider alongside region in the update request body.
            // Fetch the current workspace to get the existing cloudProvider.
            const workspace = await this.apiClient.getStreamWorkspace({
                params: { path: { groupId: projectId, tenantName: workspaceName } },
            });
            const cloudProvider = workspace?.dataProcessRegion?.cloudProvider;
            if (!cloudProvider) {
                return {
                    content: [
                        {
                            type: "text",
                            text:
                                "Unable to update workspace region: the current workspace does not specify a cloud provider. " +
                                "The Atlas API requires cloudProvider when updating region. Inspect the workspace in Atlas and try again.",
                        },
                    ],
                    isError: true,
                };
            }
            body.cloudProvider = cloudProvider;
            body.region = op.newRegion;
        }
        if (op.newTier) {
            body.streamConfig = { tier: op.newTier };
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

        const updated = await this.apiClient.updateStreamWorkspace({
            params: { path: { groupId: projectId, tenantName: workspaceName } },
            // Atlas OpenAPI types cloudProvider/region as literal enums and streamConfig.tier
            // similarly; we validate at the input schema layer so the cast is safe here.
            body: body as never,
        });

        const updatedRegion = updated?.dataProcessRegion?.region;
        if (op.newRegion && updatedRegion !== undefined && updatedRegion !== null && updatedRegion !== op.newRegion) {
            return {
                content: [
                    {
                        type: "text",
                        text:
                            `Failed to update workspace region to '${op.newRegion}'. ` +
                            `Current region is '${updatedRegion}'. ` +
                            `Verify the region name is valid for the workspace's cloud provider.`,
                    },
                ],
                isError: true,
            };
        }

        return {
            content: [
                {
                    type: "text",
                    text: `Workspace '${workspaceName}' updated. Use \`atlas-streams-discover\` with action 'inspect-workspace' to verify changes.`,
                },
            ],
        };
    }

    private async updateConnection(
        projectId: string,
        workspaceName: string,
        op: z.infer<typeof UpdateConnectionOp>
    ): Promise<CallToolResult> {
        const name = op.resourceName;

        let connectionType: string | undefined = op.connectionType;
        if (!connectionType) {
            const existing = (await this.apiClient.getStreamConnection({
                params: { path: { groupId: projectId, tenantName: workspaceName, connectionName: name } },
            })) as { type?: string };
            connectionType = existing?.type;
        }

        const normalizedConfig = ConnectionConfig.parse(op.connectionConfig);

        // Per-type validation in update mode: unknown/immutable fields rejected before Atlas.
        if (connectionType) {
            const typeValidationError = rejectInvalidConnectionConfig(
                normalizedConfig as Record<string, unknown>,
                connectionType,
                "update"
            );
            if (typeValidationError) {
                return typeValidationError;
            }
        }

        await this.apiClient.updateStreamConnection({
            params: { path: { groupId: projectId, tenantName: workspaceName, connectionName: name } },
            // StreamsConnection body is a discriminated union in the OpenAPI types; our
            // normalized shape is validated by ConnectionConfig + per-type handling in build.ts.
            body: {
                ...normalizedConfig,
                ...(connectionType !== undefined ? { type: connectionType } : {}),
                name,
            } as never,
        });

        return {
            content: [
                {
                    type: "text",
                    text: `Connection '${name}' updated in workspace '${workspaceName}'.`,
                },
            ],
        };
    }

    private async acceptPeering(projectId: string, op: z.infer<typeof AcceptPeeringOp>): Promise<CallToolResult> {
        await this.apiClient.acceptVpcPeeringConnection({
            params: { path: { groupId: projectId, id: op.peeringId } },
            body: {
                requesterAccountId: op.requesterAccountId,
                requesterVpcId: op.requesterVpcId,
            },
        });

        return {
            content: [
                {
                    type: "text",
                    text: `VPC peering connection '${op.peeringId}' accepted. It may take a few minutes to become active.`,
                },
            ],
        };
    }

    private async rejectPeering(projectId: string, op: z.infer<typeof RejectPeeringOp>): Promise<CallToolResult> {
        await this.apiClient.rejectVpcPeeringConnection({
            params: { path: { groupId: projectId, id: op.peeringId } },
        });

        return {
            content: [
                {
                    type: "text",
                    text: `VPC peering connection '${op.peeringId}' rejected.`,
                },
            ],
        };
    }
}
