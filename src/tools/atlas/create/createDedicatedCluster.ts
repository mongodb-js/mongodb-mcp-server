import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { type ToolArgs, type OperationType } from "../../tool.js";
import { AtlasToolBase } from "../atlasTool.js";
import type { ClusterDescription20240805 } from "../../../common/atlas/openapi.js";
import { ensureCurrentIpInAccessList } from "../../../common/atlas/accessListUtils.js";
import { AtlasArgs } from "../../args.js";
import { z } from "zod";

const INSTANCE_SIZES = ["M10", "M20", "M30", "M40", "M50", "M60", "M80"] as const;
type InstanceSize = (typeof INSTANCE_SIZES)[number];

const DEFAULT_REGION: Record<"AWS" | "AZURE" | "GCP", string> = {
    AWS: "US_EAST_1",
    AZURE: "US_EAST_2",
    GCP: "CENTRAL_US",
};

// Returns the highest instance size the cluster is allowed to auto-scale up to.
// Dev clusters cap at M30 to limit runaway costs. Prod clusters scale up 2 tiers.
function autoScalingMax(instanceSize: InstanceSize, preset: "development" | "production"): InstanceSize {
    const idx = INSTANCE_SIZES.findIndex((s) => s === instanceSize);
    if (preset === "development") {
        const capIdx = INSTANCE_SIZES.findIndex((s) => s === "M30");
        return INSTANCE_SIZES[Math.max(idx, Math.min(idx + 2, capIdx))] as InstanceSize;
    }
    return INSTANCE_SIZES[Math.min(idx + 2, INSTANCE_SIZES.length - 1)] as InstanceSize;
}

export class CreateDedicatedClusterTool extends AtlasToolBase {
    static toolName = "atlas-create-dedicated-cluster";
    static operationType: OperationType = "create";

    public description =
        "Create a dedicated MongoDB Atlas cluster using a preset. " +
        "Use 'development' for a cost-optimized M10 replica set with auto-scaling and no backup. " +
        "Use 'production' for a reliability-focused M30 cluster with backup, point-in-time recovery, and termination protection.";

    public argsShape = {
        projectId: AtlasArgs.projectId().describe("Atlas project ID to create the cluster in"),
        name: AtlasArgs.clusterName().describe("Name of the cluster"),
        preset: z
            .enum(["development", "production"])
            .describe(
                "'development': M10 replica set, no backup, auto-scaling capped at M30, termination protection off. " +
                    "'production': M30 replica set, continuous backup + point-in-time recovery, auto-scaling up 2 tiers, termination protection on."
            ),
        provider: z.enum(["AWS", "AZURE", "GCP"]).default("AWS").describe("Cloud provider for the cluster"),
        region: AtlasArgs.region()
            .optional()
            .describe("Cloud region. Defaults: AWS → US_EAST_1, AZURE → US_EAST_2, GCP → CENTRAL_US"),
        instanceSize: z
            .enum(INSTANCE_SIZES)
            .optional()
            .describe("Override the preset instance size. Development default: M10. Production default: M30."),
        shards: z
            .number()
            .int()
            .min(1)
            .max(10)
            .optional()
            .describe(
                "Number of shards. Defaults to 1 (replica set). Values above 1 create a sharded cluster with one replica set per shard."
            ),
        secondaryRegion: AtlasArgs.region()
            .optional()
            .describe(
                "Second cloud region for multi-region high availability. Adds 2 electable nodes in this region alongside the 3 in the primary region."
            ),
    };

    protected async execute({
        projectId,
        name,
        preset,
        provider,
        region,
        instanceSize,
        shards,
        secondaryRegion,
    }: ToolArgs<typeof this.argsShape>): Promise<CallToolResult> {
        const isProd = preset === "production";
        const effectiveInstanceSize: InstanceSize = instanceSize ?? (isProd ? "M30" : "M10");
        const effectiveRegion = region ?? DEFAULT_REGION[provider];
        const effectiveShards = shards ?? 1;
        const scaleMax = autoScalingMax(effectiveInstanceSize, preset);

        const autoScaling = {
            compute: {
                enabled: true,
                scaleDownEnabled: true,
                minInstanceSize: effectiveInstanceSize,
                maxInstanceSize: scaleMax,
            },
            diskGB: { enabled: true },
        };

        const regionConfigs: object[] = [
            {
                providerName: provider,
                regionName: effectiveRegion,
                priority: 7,
                electableSpecs: { instanceSize: effectiveInstanceSize, nodeCount: 3 },
                autoScaling,
            },
        ];

        if (secondaryRegion) {
            regionConfigs.push({
                providerName: provider,
                regionName: secondaryRegion,
                priority: 6,
                electableSpecs: { instanceSize: effectiveInstanceSize, nodeCount: 2 },
                autoScaling,
            });
        }

        const clusterType = effectiveShards > 1 ? "SHARDED" : "REPLICASET";
        const replicationSpec = { zoneName: "Zone 1", regionConfigs };

        const body = {
            groupId: projectId,
            name,
            clusterType,
            replicationSpecs: Array.from({ length: effectiveShards }, () => replicationSpec),
            backupEnabled: isProd,
            pitEnabled: isProd,
            terminationProtectionEnabled: isProd,
        } as unknown as ClusterDescription20240805;

        await ensureCurrentIpInAccessList(this.apiClient, projectId);
        await this.apiClient.createCluster({
            params: { path: { groupId: projectId } },
            body,
        });

        const lines = [
            `Cluster "${name}" creation started.`,
            `  Preset:      ${preset}`,
            `  Provider:    ${provider} / ${effectiveRegion}`,
            `  Size:        ${effectiveInstanceSize} (auto-scaling → ${scaleMax})`,
            `  Type:        ${clusterType}${effectiveShards > 1 ? ` (${effectiveShards} shards)` : ""}`,
            `  Backup:      ${isProd ? "enabled (with point-in-time recovery)" : "disabled"}`,
            `  Termination: ${isProd ? "protected" : "unprotected"}`,
        ];

        if (secondaryRegion) {
            lines.push(`  Multi-region: ${effectiveRegion} (primary) + ${secondaryRegion} (secondary)`);
        }

        return {
            content: [{ type: "text", text: lines.join("\n") }],
        };
    }
}
