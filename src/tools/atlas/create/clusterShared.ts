import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

export const DEDICATED_SIZES = [
    "M10",
    "M20",
    "M30",
    "M40",
    "M50",
    "M60",
    "M80",
    "M140",
    "M200",
    "M300",
    "M400",
    "M700",
] as const;

export type DedicatedSize = (typeof DEDICATED_SIZES)[number];

interface AutoScalingSpec {
    compute?: { enabled: true; scaleDownEnabled: true; minInstanceSize: DedicatedSize; maxInstanceSize: DedicatedSize };
    diskGBEnabled: boolean;
}

export function buildAutoScaling(
    instanceSize: DedicatedSize | undefined,
    minInstanceSize: DedicatedSize,
    maxInstanceSize: DedicatedSize,
    diskGBEnabled: boolean
): AutoScalingSpec {
    const fixedSize = !!instanceSize;
    return {
        ...(!fixedSize && {
            compute: {
                enabled: true as const,
                scaleDownEnabled: true as const,
                minInstanceSize,
                maxInstanceSize,
            },
        }),
        diskGBEnabled,
    };
}

export interface RegionSpec {
    name: string;
    provider: string;
    priority: number;
    nodeCount: number;
}

interface RegionConfig {
    providerName: string;
    regionName: string;
    priority: number;
    electableSpecs: { instanceSize: DedicatedSize; nodeCount: number };
    autoScaling: AutoScalingSpec;
}

export interface ReplicationSpec {
    regionConfigs: RegionConfig[];
}

export function buildReplicationSpec(
    regions: RegionSpec[],
    instanceSize: DedicatedSize | undefined,
    minInstanceSize: DedicatedSize,
    maxInstanceSize: DedicatedSize,
    diskGBEnabled: boolean
): ReplicationSpec {
    return {
        regionConfigs: regions.map(({ name, provider, priority, nodeCount }) => ({
            providerName: provider,
            regionName: name,
            priority,
            electableSpecs: {
                instanceSize: instanceSize ?? minInstanceSize,
                nodeCount,
            },
            autoScaling: buildAutoScaling(instanceSize, minInstanceSize, maxInstanceSize, diskGBEnabled),
        })),
    };
}

export const sharedClusterArgsShape = {
    clusterType: z
        .enum(["REPLICASET", "SHARDED"])
        .default("REPLICASET")
        .describe("REPLICASET for standard HA; SHARDED for horizontal write scaling (adds cost per shard)."),
    provider: z
        .enum(["AWS", "AZURE", "GCP"])
        .default("AWS")
        .describe("Cloud provider. AWS is most common and has the widest region coverage."),
    instanceSize: z
        .enum(DEDICATED_SIZES)
        .optional()
        .describe(
            "Fixed instance size — disables compute auto-scaling. Use only when you need cost predictability. Dev: M10 (~$57/mo). Production minimum: M30 (~$388/mo). When set, minInstanceSize/maxInstanceSize are ignored."
        ),
    minInstanceSize: z
        .enum(DEDICATED_SIZES)
        .default("M10")
        .describe(
            "Lower bound for compute auto-scaling. Dev: M10. Production minimum: M30. Ignored when instanceSize is set."
        ),
    maxInstanceSize: z
        .enum(DEDICATED_SIZES)
        .default("M200")
        .describe("Upper bound for compute auto-scaling. Caps cost exposure. Ignored when instanceSize is set."),
    backupEnabled: z
        .boolean()
        .default(false)
        .describe(
            "Enable cloud backup snapshots. Required for production (data recovery SLA, audit compliance). Set false for dev/test — backup storage adds ~20% cost and is unnecessary for non-critical data."
        ),
    pitEnabled: z
        .boolean()
        .default(false)
        .describe(
            "Enable Point-in-Time restore (PITR). Requires backupEnabled=true. Allows recovery to any second in the last 7 days — mandatory for audit compliance and zero-data-loss production requirements. Adds ~10–15% storage cost on top of backup. Set false for dev/test and cost-optimised production (daily snapshots are sufficient)."
        ),
    diskSizeGb: z
        .number()
        .min(10)
        .optional()
        .describe(
            "Storage per node in GB. Omit to use Atlas defaults (10 GB at M10). When diskGBEnabled=true, Atlas grows storage automatically — set a starting size only when you know the initial dataset size."
        ),
    diskGBEnabled: z
        .boolean()
        .default(true)
        .describe(
            "Enable disk auto-scaling. Recommended for all environments — Atlas grows storage automatically as data increases, avoiding manual resizes and downtime. Disable only when storage must be strictly capped for cost control."
        ),
    shardCount: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe(
            "Number of shards. Only valid when clusterType=SHARDED — enforced via superRefine. Each shard multiplies node cost by the number of regions. Omit for REPLICASET."
        ),
    tags: z
        .record(z.string(), z.string())
        .default({})
        .describe(
            "Key-value tags for billing, data classification, and governance. Recommended keys: Environment (dev/staging/prod), Team, Application, CostCenter. Values 1–255 chars."
        ),
    terminationProtectionEnabled: z
        .boolean()
        .default(false)
        .describe(
            "Prevent accidental cluster deletion. Enable for production clusters. When true, Atlas rejects all delete requests until you explicitly disable it."
        ),
};

export function validateSharedArgs(args: {
    pitEnabled: boolean;
    backupEnabled: boolean;
    shardCount?: number;
    clusterType: string;
}): CallToolResult | null {
    if (args.pitEnabled && !args.backupEnabled) {
        return {
            content: [{ type: "text", text: "pitEnabled requires backupEnabled to be true" }],
            isError: true,
        };
    }
    if (args.shardCount !== undefined && args.clusterType !== "SHARDED") {
        return {
            content: [{ type: "text", text: "shardCount is only valid when clusterType is SHARDED" }],
            isError: true,
        };
    }
    return null;
}

interface ClusterBodySpec {
    name: string;
    clusterType: string;
    backupEnabled: boolean;
    pitEnabled: boolean;
    terminationProtectionEnabled: boolean;
    paused: false;
    diskSizeGB?: number;
    tags: { key: string; value: string }[];
    replicationSpecs: ReplicationSpec[];
}

export function buildClusterBody(
    name: string,
    clusterType: "REPLICASET" | "SHARDED",
    backupEnabled: boolean,
    pitEnabled: boolean,
    diskSizeGb: number | undefined,
    shardCount: number | undefined,
    tags: Record<string, string>,
    terminationProtectionEnabled: boolean,
    replicationSpec: ReplicationSpec
): ClusterBodySpec {
    const numShards = clusterType === "SHARDED" ? (shardCount ?? 1) : 1;
    const replicationSpecs = Array.from({ length: numShards }, () => replicationSpec);
    return {
        name,
        clusterType,
        backupEnabled,
        pitEnabled,
        terminationProtectionEnabled,
        paused: false,
        ...(diskSizeGb && { diskSizeGB: diskSizeGb }),
        tags: Object.entries(tags).map(([key, value]) => ({ key, value })),
        replicationSpecs,
    };
}
