import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { type ToolArgs, type OperationType } from "../../tool.js";
import { AtlasToolBase } from "../atlasTool.js";
import type { ClusterDescription20240805 } from "../../../common/atlas/openapi.js";
import { AtlasArgs } from "../../args.js";
import { sharedClusterArgsShape, buildReplicationSpec, buildClusterBody } from "./clusterShared.js";

export class CreateThreeRegionClusterTool extends AtlasToolBase {
    static toolName = "atlas-create-three-regions";
    public description =
        "Create a MongoDB Atlas cluster across three regions with full regional-failure HA. " +
        "9 electable nodes (3 per region) — losing any single region leaves 6 nodes, " +
        "well above quorum. Required for production workloads with strict availability SLAs " +
        "(e.g. zero-downtime requirements, $500K+/hour outage cost). " +
        "Cost is roughly 3× a single-region cluster of the same instance size.";
    static operationType: OperationType = "create";

    public argsShape = {
        projectId: AtlasArgs.projectId().describe("Atlas project ID (24-char hex)"),
        name: AtlasArgs.clusterName().describe("Cluster name, 1–64 chars, [a-zA-Z0-9_-]"),
        ...sharedClusterArgsShape,
        region1: AtlasArgs.region()
            .default("US_EAST_1")
            .describe("Primary region (priority 7). Must be in the same cloud region as your application."),
        region2: AtlasArgs.region()
            .default("US_EAST_2")
            .describe(
                "Secondary region (priority 6). Should be in the same cloud provider for lowest cross-region transfer cost."
            ),
        region3: AtlasArgs.region()
            .default("US_WEST_2")
            .describe(
                "Tertiary region (priority 5). Provides the third quorum member — the cluster survives a full primary-region failure."
            ),
        provider2: z
            .enum(["AWS", "AZURE", "GCP"])
            .optional()
            .describe("Override cloud provider for region2. Omit to use the same provider as region1."),
        provider3: z
            .enum(["AWS", "AZURE", "GCP"])
            .optional()
            .describe(
                "Override cloud provider for region3. Cross-provider placement adds resilience against cloud-provider outages at the cost of higher data transfer fees."
            ),
        nodeCount: z
            .number()
            .int()
            .refine((n) => n % 2 === 1, "nodeCount must be odd")
            .default(3)
            .describe(
                "Electable nodes per region (must be odd: 3, 5, 7). 3 per region = 9 total — losing any single region leaves 6 nodes, well above quorum. Higher counts add read throughput and cost."
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
            region1,
            region2,
            region3,
            provider2,
            provider3,
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
            [
                { name: region1, provider, priority: 7, nodeCount },
                { name: region2, provider: provider2 ?? provider, priority: 6, nodeCount },
                { name: region3, provider: provider3 ?? provider, priority: 5, nodeCount },
            ],
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
            content: [
                {
                    type: "text",
                    text: `Cluster "${name}" is being created across three regions: "${region1}" (primary), "${region2}" (secondary), "${region3}" (tertiary) with ${nodeCount} nodes per region.`,
                },
            ],
        };
    }
}
