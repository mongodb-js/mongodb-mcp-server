import { z } from "zod";
import { type OperationType, type ToolArgs, type ToolResult } from "../../tool.js";
import { AtlasToolBase } from "../atlasTool.js";
import type { ClusterDescription20240805 } from "../../../common/atlas/openapi.js";
import { AtlasArgs } from "../../args.js";
import type { CreateClusterMetadata } from "../../../telemetry/types.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

/** @public */
export const ATLAS_CREATE_CLUSTER_README_DESCRIPTION =
    "Create a MongoDB Atlas cluster (M10–M80, replica set or single shard). " +
    "Compute autoscaling is enabled by default: min instance size is set to the selected instance size, max is set two tiers above. " +
    "Disk autoscaling is always enabled. The tool returns immediately, use the atlas-inspect-cluster tool to poll the cluster state for readiness (state: IDLE). " +
    "Connection strings are unavailable until the cluster reaches IDLE state.";

// Keeping this region recommendation string and the one for atlas-upgrade-cluster independent in the short term. The current effort is intentionally limited to additive changes only.
// Differences include the mention of "non-exhaustive" and a nudge to respect user-specified regions when not in the mapping.
const REGION_RECOMMENDATIONS = `Common, non-exhaustive region default mappings by provider:
AWS: "East Coast"/"Virginia"/"US East" → US_EAST_1, "Ohio" → US_EAST_2, "California"/"West Coast" → US_WEST_2, "Southeast Asia"/"APAC"/"Singapore" → AP_SOUTHEAST_1, "Europe"/"EU"/"Ireland" → EU_WEST_1.
GCP: "Central US" → CENTRAL_US, "Western US" → WESTERN_US, "Southeast Asia"/"APAC" → SOUTHEASTERN_ASIA_PACIFIC, "Europe"/"EU" → WESTERN_EUROPE.
AZURE: "East US" → US_EAST_2, "West US" → US_WEST_2, "Europe North" → EUROPE_NORTH, "Europe West" → EUROPE_WEST.
Default recommendation: AWS US_EAST_1.
User-specified regions not present in the mapping MUST be respected, rely on the tool to surface errors if a region is not supported.
`;

const instanceSizeEnum = z.enum(["M10", "M20", "M30", "M40", "M50", "M60", "M80"]);
const cloudProviderEnum = z.enum(["AWS", "GCP", "AZURE"]);
const clusterTypeEnum = z.enum(["REPLICASET", "SHARDED"]);
const mongoDBVersionEnum = z.enum(["7.0", "8.0", "LATEST"]);
const backupEnum = z.enum(["OFF", "SNAPSHOT", "CONTINUOUS"]);

type InstanceSize = z.infer<typeof instanceSizeEnum>;
type CloudProvider = z.infer<typeof cloudProviderEnum>;
type MongoDBVersion = z.infer<typeof mongoDBVersionEnum>;
type Backup = z.infer<typeof backupEnum>;

function getMaxAutoScalingSize(size: InstanceSize, provider: CloudProvider): string {
    // M60 and M80 extend beyond the selectable range. M140 is not supported on Azure.
    if (size === "M80") return "M200";
    if (size === "M60") return provider === "AZURE" ? "M200" : "M140";
    return instanceSizeEnum.options[instanceSizeEnum.options.indexOf(size) + 2] ?? "M80";
}

type AutoScalingConfig = {
    compute: {
        enabled: boolean;
        scaleDownEnabled: boolean;
        minInstanceSize?: string;
        maxInstanceSize?: string;
    };
    diskGB: { enabled: true };
};

type ReplicationSpec = {
    regionConfigs: Array<{
        providerName: string;
        regionName: string;
        priority: number;
        electableSpecs: { instanceSize: InstanceSize; nodeCount: number; diskSizeGB?: number };
        autoScaling: AutoScalingConfig;
    }>;
};

function buildAutoScaling(
    instanceSize: InstanceSize,
    computeEnabled: boolean,
    provider: CloudProvider
): AutoScalingConfig {
    return {
        compute: {
            enabled: computeEnabled,
            scaleDownEnabled: computeEnabled,
            minInstanceSize: computeEnabled ? instanceSize : undefined,
            maxInstanceSize: computeEnabled ? getMaxAutoScalingSize(instanceSize, provider) : undefined,
        },
        diskGB: { enabled: true },
    };
}

function buildReplicationSpecs(
    provider: CloudProvider,
    region: string,
    instanceSize: InstanceSize,
    autoScaling: AutoScalingConfig,
    diskSizeGB?: number
): ReplicationSpec[] {
    return [
        {
            regionConfigs: [
                {
                    providerName: provider,
                    regionName: region,
                    priority: 7,
                    electableSpecs: { instanceSize, nodeCount: 3, diskSizeGB },
                    autoScaling,
                },
            ],
        },
    ];
}

function buildBackupConfig(backups: Backup): {
    backupEnabled: boolean;
    pitEnabled: boolean;
} {
    switch (backups) {
        case "OFF":
            return { backupEnabled: false, pitEnabled: false };
        case "SNAPSHOT":
            return { backupEnabled: true, pitEnabled: false };
        case "CONTINUOUS":
            return { backupEnabled: true, pitEnabled: true };
    }
}

function buildVersionConfig(version: MongoDBVersion): {
    versionReleaseSystem: "LTS" | "CONTINUOUS";
    mongoDBMajorVersion?: string;
} {
    if (version === "LATEST") {
        return { versionReleaseSystem: "CONTINUOUS" };
    }
    return { versionReleaseSystem: "LTS", mongoDBMajorVersion: version };
}

class CreateClusterError extends Error {}

export const CreateClusterArgsShape = {
    projectId: AtlasArgs.projectId().describe(
        "Atlas project ID to create the cluster in. Use the atlas-list-projects to find project IDs if not provided."
    ),

    clusterName: AtlasArgs.clusterName().describe("Name of the cluster."),

    provider: cloudProviderEnum.describe("Cloud provider for the cluster."),

    region: AtlasArgs.region().describe(
        "Cloud provider region in Atlas format using uppercase letters and underscores (e.g. US_EAST_1)."
    ),

    clusterType: clusterTypeEnum
        .default("REPLICASET")
        .describe(
            "Cluster topology. Use `SHARDED` for single-shard clusters, requires M30 or higher. Defaults to `REPLICASET`."
        ),

    instanceSize: instanceSizeEnum
        .optional()
        .describe(
            "Instance size. NVME and high-memory instances are not supported. Minimum M30 when clusterType is SHARDED. Defaults to M10 for projects with fewer than 2 existing clusters, M30 otherwise. Omit unless explicitly specified by the user."
        ),

    computeAutoScaling: z
        .boolean()
        .default(true)
        .describe(
            "When true, enables compute autoscaling. Min instance size is set to the selected instance size, max is set two tiers above. Omit unless explicitly specified by the user."
        ),

    diskSizeGB: z
        .number()
        .positive()
        .optional()
        .describe(
            "Initial disk size in GB. Disk autoscaling is always enabled regardless of this value. Omit unless explicitly specified by the user."
        ),

    mongoDBVersion: mongoDBVersionEnum
        .default("LATEST")
        .describe(
            "MongoDB version to deploy. Use a pinned version for production environments where version stability is required. Defaults to `LATEST`."
        ),

    backup: backupEnum
        .default("SNAPSHOT")
        .describe(
            "`OFF`: no backups. `SNAPSHOT`: cloud backup snapshots, recommended for most workloads. `CONTINUOUS`: point-in-time restore, required for RPO-sensitive production workloads. Defaults to `SNAPSHOT`."
        ),

    terminationProtectionEnabled: z
        .boolean()
        .default(false)
        .describe(
            "When true, prevents the cluster from being deleted until protection is explicitly disabled. Recommended for production clusters. Defaults to false."
        ),
};

const CreateClusterOutputSchema = {
    clusterId: z.string().optional(),
    provider: cloudProviderEnum,
    region: z.string(),
    instanceSize: instanceSizeEnum,
    clusterType: clusterTypeEnum,
    mongoDBVersion: mongoDBVersionEnum,
    backup: backupEnum,
    computeAutoScaling: z.boolean(),
    terminationProtectionEnabled: z.boolean(),
    diskSizeGB: z.number().optional(),
};

export class CreateClusterTool extends AtlasToolBase {
    static toolName = "atlas-create-cluster";
    static operationType: OperationType = "create";
    public description =
        "Create a MongoDB Atlas cluster (M10–M80, replica set or single shard). " +
        "Compute autoscaling is enabled by default: min instance size is set to the selected instance size, max is set two tiers above. " +
        "Disk autoscaling is always enabled. The tool returns immediately, use the atlas-inspect-cluster tool to poll the cluster state for readiness (state: IDLE). " +
        "Connection strings are unavailable until the cluster reaches IDLE state. " +
        "Note to LLM: Omit instance size unless specified by the user. If provider and region are not already known, ask for both together in a single question before calling this tool. " +
        REGION_RECOMMENDATIONS;
    public override outputSchema = CreateClusterOutputSchema;
    public argsShape = CreateClusterArgsShape;

    protected async execute(args: ToolArgs<typeof this.argsShape>): Promise<ToolResult<typeof this.outputSchema>> {
        const { projectId, clusterName, provider, region, clusterType, terminationProtectionEnabled } = args;

        if (clusterType === "SHARDED" && (args.instanceSize === "M10" || args.instanceSize === "M20")) {
            throw new CreateClusterError("SHARDED clusters require M30 or higher instance size.");
        }

        let instanceSize: InstanceSize;
        if (args.instanceSize !== undefined) {
            instanceSize = args.instanceSize;
        } else if (clusterType === "SHARDED") {
            instanceSize = "M30";
        } else {
            // REPLICASET defaults to M10 if there are less than 2 clusters in the project, M30 otherwise.
            const existing = await this.apiClient.listClusters({ params: { path: { groupId: projectId } } });
            instanceSize = (existing.results?.length ?? 0) < 2 ? "M10" : "M30";
        }

        const autoScaling = buildAutoScaling(instanceSize, args.computeAutoScaling, provider);
        const replicationSpecs = buildReplicationSpecs(provider, region, instanceSize, autoScaling, args.diskSizeGB);
        const backupConfig = buildBackupConfig(args.backup);
        const versionConfig = buildVersionConfig(args.mongoDBVersion);

        const body = {
            name: clusterName,
            clusterType,
            replicationSpecs,
            terminationProtectionEnabled,
            ...backupConfig,
            ...versionConfig,
        } as unknown as ClusterDescription20240805;

        const result = await this.apiClient.createCluster({
            params: { path: { groupId: projectId } },
            body,
        });

        return {
            content: [
                {
                    type: "text",
                    text:
                        `Cluster "${clusterName}" is being created in project "${projectId}" (${instanceSize} ${clusterType} on ${provider}/${region}). ` +
                        `Use the atlas-inspect-cluster tool with projectId "${projectId}" and clusterName "${clusterName}" to poll for readiness. ` +
                        `The cluster is ready when its state is IDLE, connection strings are unavailable until then.`,
                },
            ],
            structuredContent: {
                clusterId: result.id,
                provider,
                region,
                instanceSize,
                clusterType,
                mongoDBVersion: args.mongoDBVersion,
                backup: args.backup,
                computeAutoScaling: args.computeAutoScaling,
                terminationProtectionEnabled,
                diskSizeGB: args.diskSizeGB,
            },
        };
    }

    protected override handleError(error: unknown, args: ToolArgs<typeof this.argsShape>): CallToolResult {
        if (error instanceof CreateClusterError) {
            return {
                content: [{ type: "text", text: error.message }],
                isError: true,
            };
        }
        return super.handleError(error, args) as CallToolResult;
    }

    protected override resolveTelemetryMetadata(
        args: ToolArgs<typeof this.argsShape>,
        context: { result: CallToolResult }
    ): CreateClusterMetadata {
        const parentMetadata = super.resolveTelemetryMetadata(args, context);
        type Output = z.infer<z.ZodObject<typeof CreateClusterOutputSchema>>;
        const sc = context.result.structuredContent as Output | undefined;
        return {
            ...parentMetadata,
            cluster_id: sc?.clusterId,
            provider: sc?.provider,
            region: sc?.region,
            instance_size: sc?.instanceSize,
            cluster_type: sc?.clusterType,
            backup: sc?.backup,
            compute_auto_scaling: sc !== undefined ? (sc.computeAutoScaling ? "true" : "false") : undefined,
            termination_protection: sc !== undefined ? (sc.terminationProtectionEnabled ? "true" : "false") : undefined,
            disk_size_gb: sc?.diskSizeGB,
            mongodb_version: sc?.mongoDBVersion,
        };
    }
}
