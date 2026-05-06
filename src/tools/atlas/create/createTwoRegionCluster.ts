import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { type ToolArgs, type OperationType } from "../../tool.js";
import { AtlasToolBase } from "../atlasTool.js";
import type { ClusterDescription20240805 } from "../../../common/atlas/openapi.js";
import { AtlasArgs } from "../../args.js";
import { sharedClusterArgsShape, buildReplicationSpec, buildClusterBody, validateSharedArgs } from "./clusterShared.js";

export class CreateTwoRegionClusterTool extends AtlasToolBase {
    static toolName = "atlas-create-two-regions";
    public description =
        "Create a MongoDB Atlas cluster spanning two regions — primary (3 nodes) + secondary (2 nodes) = 5 total. " +
        "Provides geo-distributed reads and basic cross-region redundancy. " +
        "WARNING: does NOT survive a primary-region outage — losing the primary region loses quorum. " +
        "The cluster goes read-only until the region recovers. For full regional-failover HA, use " +
        "atlas-create-three-regions instead. Cost is ~2× a single-region cluster.";
    static operationType: OperationType = "create";

    public argsShape = {
        projectId: AtlasArgs.projectId().describe("Atlas project ID (24-char hex)"),
        name: AtlasArgs.clusterName().describe("Cluster name, 1–64 chars, [a-zA-Z0-9_-]"),
        ...sharedClusterArgsShape,
        region1: AtlasArgs.region()
            .default("US_EAST_1")
            .describe(
                "Primary region (priority 7, 3 nodes). Place in the same cloud region as your application to minimize write latency."
            ),
        region2: AtlasArgs.region()
            .default("EU_WEST_1")
            .describe(
                "Secondary region (priority 6, 2 nodes). Hosts secondary replicas for read scaling and cross-region redundancy."
            ),
        provider2: z
            .enum(["AWS", "AZURE", "GCP"])
            .optional()
            .describe(
                "Override cloud provider for region2. Omit to use the same provider as region1. Cross-provider traffic incurs additional data transfer costs."
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
            tags,
            terminationProtectionEnabled,
            region1,
            region2,
            provider2,
        } = args;

        const validationError = validateSharedArgs(args);
        if (validationError) return validationError;

        const replicationSpec = buildReplicationSpec(
            [
                { name: region1, provider, priority: 7, nodeCount: 3 },
                { name: region2, provider: provider2 ?? provider, priority: 6, nodeCount: 2 },
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
            tags,
            terminationProtectionEnabled,
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
                    text: `Cluster "${name}" is being created across regions "${region1}" (primary, 3 nodes) and "${region2}" (secondary, 2 nodes). Node count is fixed: 3 primary + 2 secondary = 5 total.`,
                },
                { type: "text", text: `Ensure your IP is in the project access list before connecting.` },
            ],
        };
    }
}
