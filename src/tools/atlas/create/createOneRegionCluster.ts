import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { type ToolArgs, type OperationType } from "../../tool.js";
import { AtlasToolBase } from "../atlasTool.js";
import type { ClusterDescription20240805 } from "../../../common/atlas/openapi.js";
import { AtlasArgs } from "../../args.js";
import { sharedClusterArgsShape, buildReplicationSpec, buildClusterBody } from "./clusterShared.js";

export class CreateOneRegionClusterTool extends AtlasToolBase {
    static toolName = "atlas-create-one-region";
    public description =
        "Create a dedicated MongoDB Atlas cluster in a single region. " +
        "Use for dev/test (start at M10, ~$57/mo) or single-region production (M30+, ~$388/mo). " +
        "Supports REPLICASET (default) or SHARDED topology.";
    static operationType: OperationType = "create";

    public argsShape = {
        projectId: AtlasArgs.projectId().describe("Atlas project ID (24-char hex)"),
        name: AtlasArgs.clusterName().describe("Cluster name, 1–64 chars, [a-zA-Z0-9_-]"),
        ...sharedClusterArgsShape,
        region: AtlasArgs.region()
            .default("US_EAST_1")
            .describe(
                "Cloud region. Use the region closest to your application to minimize latency and avoid cross-region data transfer charges."
            ),
        nodeCount: z
            .number()
            .int()
            .refine((n) => n % 2 === 1, "nodeCount must be odd")
            .default(3)
            .describe(
                "Electable nodes in the region (must be odd: 3, 5, 7). 3 is sufficient for all standard workloads. Higher counts add read throughput and cost."
            ),
    };

    protected async execute(args: ToolArgs<typeof this.argsShape>): Promise<CallToolResult> {
        const {
            projectId,
            name,
            clusterType,
            provider,
            instanceSize,
            minInstanceSize,
            maxInstanceSize,
            backupEnabled,
            pitEnabled,
            diskSizeGb,
            diskGBEnabled,
            shardCount,
            region,
            nodeCount,
        } = args;

        if (pitEnabled && !backupEnabled) {
            return {
                content: [{ type: "text", text: "pitEnabled requires backupEnabled to be true" }],
                isError: true,
            };
        }

        if (shardCount !== undefined && clusterType !== "SHARDED") {
            return {
                content: [{ type: "text", text: "shardCount is only valid when clusterType is SHARDED" }],
                isError: true,
            };
        }

        const replicationSpec = buildReplicationSpec(
            [{ name: region, provider, priority: 7, nodeCount }],
            instanceSize,
            minInstanceSize,
            maxInstanceSize,
            diskGBEnabled
        );

        const body = buildClusterBody(
            name,
            clusterType,
            backupEnabled,
            pitEnabled,
            diskSizeGb,
            shardCount,
            replicationSpec
        );

        await this.apiClient.createCluster({
            params: { path: { groupId: projectId } },
            body: body as unknown as ClusterDescription20240805,
        });

        return {
            content: [{ type: "text", text: `Cluster "${name}" is being created in region "${region}".` }],
        };
    }
}
