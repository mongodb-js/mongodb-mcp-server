import { z } from "zod";
import { type ToolArgs, type ToolResult, ToolArgumentValidationError } from "@mongodb-js/mcp-core";
import type { OperationType, ToolExecutionContext, ToolRequest, CallToolResult } from "@mongodb-js/mcp-types";
import type { IAtlasConfig } from "../../atlasTool.js";
import { AtlasToolBase } from "../../atlasTool.js";
import type { ClusterDescription20240805 } from "@mongodb-js/mcp-atlas-api-client";
import { AtlasArgs, type AtlasCloudProvider } from "../../args.js";
import type { CreateClusterMetadata } from "@mongodb-js/mcp-atlas-telemetry";
import { ensureCurrentIpInAccessList, getAccessListNote } from "../../helpers/accessListUtils.js";
import { ApiClientError } from "@mongodb-js/mcp-atlas-api-client";
import {
    standardInstanceSizeEnum,
    getMaxAutoScalingSize,
    infiniteInstanceSizeEnum,
    getInfiniteMaxAutoScalingSize,
    databaseEditionEnum,
    INFINITE_MAX_STORAGE_GB,
    type StandardInstanceSize,
    type InfiniteInstanceSize,
} from "../../helpers/cluster.js";

/** @public */
export const ATLAS_CREATE_CLUSTER_README_DESCRIPTION =
    "Create a MongoDB Atlas cluster (M10–M80, replica set or single shard). " +
    "Set databaseEdition to INFINITE to create an Atlas Infinite cluster (public preview): disaggregated compute and storage, AWS only, single region, replica set, M10-M60, latest MongoDB version with auto upgrades, cloud backup always enabled. " +
    "Compute autoscaling is enabled by default: min instance size is set to the selected instance size, max is set two tiers above. " +
    "Disk autoscaling is always enabled. Encryption at rest with customer-managed keys (CMK) is supported, the CMK provider must already have a valid encryption at rest configuration in the project. " +
    "The tool returns immediately, use the atlas-inspect-cluster tool to poll the cluster state for readiness (state: IDLE). " +
    "Connection strings are unavailable until the cluster reaches IDLE state.";

const clusterTypeEnum = z.enum(["REPLICASET", "SHARDED"]);
const mongoDBVersionEnum = z.enum(["7.0", "8.0", "LATEST"]);
const backupEnum = z.enum(["OFF", "SNAPSHOT", "CONTINUOUS"]);
const encryptionAtRestProviderEnum = z.enum(["AWS", "AZURE", "GCP", "NONE"]);

type MongoDBVersion = z.infer<typeof mongoDBVersionEnum>;
type Backup = z.infer<typeof backupEnum>;

type AutoScalingConfig = {
    compute: {
        enabled: boolean;
        scaleDownEnabled: boolean;
        minInstanceSize?: string;
        maxInstanceSize?: string;
    };
    diskGB: { enabled: true };
    storageConfig?: { shardSizeLimitGB: number };
};

type ReplicationSpec = {
    regionConfigs: Array<{
        providerName: string;
        regionName: string;
        priority: number;
        electableSpecs: { instanceSize: StandardInstanceSize; nodeCount: number; diskSizeGB?: number };
        autoScaling: AutoScalingConfig;
    }>;
};

function buildAutoScaling({
    instanceSize,
    computeEnabled,
    provider,
    maxInstanceSize,
}: {
    instanceSize: StandardInstanceSize;
    computeEnabled: boolean;
    provider: AtlasCloudProvider;
    maxInstanceSize?: string;
}): AutoScalingConfig {
    return {
        compute: {
            enabled: computeEnabled,
            scaleDownEnabled: computeEnabled,
            minInstanceSize: computeEnabled ? instanceSize : undefined,
            maxInstanceSize: computeEnabled
                ? (maxInstanceSize ?? getMaxAutoScalingSize(instanceSize, provider))
                : undefined,
        },
        diskGB: { enabled: true },
    };
}

const ELECTABLE_NODE_DISTRIBUTIONS = [[3], [2, 1], [2, 2, 1]] as const;

function buildReplicationSpecs({
    provider,
    regions,
    instanceSize,
    autoScaling,
    diskSizeGB,
}: {
    provider: AtlasCloudProvider;
    regions: string[];
    instanceSize: StandardInstanceSize;
    autoScaling: AutoScalingConfig;
    diskSizeGB?: number;
}): ReplicationSpec[] {
    const nodeDistribution = ELECTABLE_NODE_DISTRIBUTIONS[regions.length - 1] ?? [];

    return [
        {
            regionConfigs: regions.map((regionName, i) => {
                const nodeCount = nodeDistribution[i] ?? 3;
                return {
                    providerName: provider,
                    regionName,
                    priority: 7 - i,
                    electableSpecs: { instanceSize, nodeCount, diskSizeGB },
                    autoScaling,
                };
            }),
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

// Atlas Infinite clusters are single-region replica sets whose HA unit is one
// primary plus one standby node (2 electable nodes), with storage provisioned
// by the storage layer instead of a per-node disk.
function buildInfiniteReplicationSpecs({
    provider,
    region,
    instanceSize,
    autoScaling,
    readOnlyNodes,
    maxStorageGB,
}: {
    provider: AtlasCloudProvider;
    region: string;
    instanceSize: StandardInstanceSize;
    autoScaling: AutoScalingConfig;
    readOnlyNodes: number;
    maxStorageGB?: number;
}): ReplicationSpec[] {
    return [
        {
            regionConfigs: [
                {
                    providerName: provider,
                    regionName: region,
                    priority: 7,
                    electableSpecs: { instanceSize, nodeCount: 2 },
                    ...(readOnlyNodes > 0 && { readOnlySpecs: { instanceSize, nodeCount: readOnlyNodes } }),
                    autoScaling: {
                        ...autoScaling,
                        ...(maxStorageGB !== undefined && { storageConfig: { shardSizeLimitGB: maxStorageGB } }),
                    },
                },
            ],
        },
    ];
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

class CreateClusterError extends ToolArgumentValidationError {}

// Enforces the Atlas Infinite public preview constraints: AWS only, single
// region, replica set, M10-M60, latest version with auto upgrades, cloud
// backup always on, and no disk provisioning (storage scales on its own).
function validateInfiniteCreateArgs(args: {
    provider: AtlasCloudProvider;
    regions: string[];
    clusterType: "REPLICASET" | "SHARDED";
    instanceSize?: StandardInstanceSize;
    diskSizeGB?: number;
    mongoDBVersion: MongoDBVersion;
    backup: Backup;
    readOnlyNodes?: number;
    maxStorageGB?: number;
}): void {
    if (args.provider !== "AWS") {
        throw new CreateClusterError(
            `Atlas Infinite clusters are available on AWS only during public preview, but provider is "${args.provider}".`
        );
    }
    if (args.regions.length > 1) {
        throw new CreateClusterError(
            "Atlas Infinite clusters deploy in a single region during public preview. Provide exactly one region."
        );
    }
    if (args.clusterType === "SHARDED") {
        throw new CreateClusterError(
            "Atlas Infinite clusters do not support sharded clusters during public preview. Use clusterType REPLICASET."
        );
    }
    if (args.instanceSize !== undefined && !infiniteInstanceSizeEnum.safeParse(args.instanceSize).success) {
        throw new CreateClusterError("Atlas Infinite clusters support M10-M60 instance sizes during public preview.");
    }
    if (args.mongoDBVersion !== "LATEST") {
        throw new CreateClusterError(
            "Atlas Infinite clusters run the latest MongoDB version with auto upgrades. Omit mongoDBVersion or set it to LATEST."
        );
    }
    if (args.backup === "OFF") {
        throw new CreateClusterError(
            "Cloud backup is always enabled on Atlas Infinite clusters. Use SNAPSHOT or CONTINUOUS."
        );
    }
    if (args.diskSizeGB !== undefined) {
        throw new CreateClusterError(
            "Atlas Infinite clusters do not provision a disk size; storage scales automatically. Use maxStorageGB to cap the max storage limit instead."
        );
    }
}

export const CreateClusterArgsShape = {
    projectId: AtlasArgs.projectId().describe(
        "Atlas project ID to create the cluster in. Use the atlas-list-projects to find project IDs if not provided."
    ),

    clusterName: AtlasArgs.clusterName().describe("Name of the cluster."),

    provider: AtlasArgs.cloudProvider().describe("Cloud provider for the cluster."),

    regions: z
        .array(AtlasArgs.region())
        .min(1)
        .max(3)
        .describe(
            "Cloud provider regions in Atlas format using uppercase letters and underscores (e.g. US_EAST_1). The first region has the highest priority. Do not include duplicate regions."
        ),

    clusterType: clusterTypeEnum
        .default("REPLICASET")
        .describe(
            "Cluster topology. Use `SHARDED` for single-shard clusters, requires M30 or higher. Defaults to `REPLICASET`."
        ),

    instanceSize: standardInstanceSizeEnum
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

    encryptionAtRestProvider: encryptionAtRestProviderEnum
        .optional()
        .describe(
            "Customer-managed key provider for encryption at rest. Defaults to the cluster's provider if a valid configuration exists. Use `NONE` to explicitly disable the feature. Omit unless explicitly specified by the user."
        ),

    databaseEdition: databaseEditionEnum
        .default("CORE")
        .describe(
            "Database edition. `CORE` is the standard Atlas dedicated cluster. `INFINITE` creates an Atlas Infinite cluster (public preview): disaggregated compute and storage, AWS only, single region, replica set, M10-M60 instance sizes, latest MongoDB version with auto upgrades, cloud backup always enabled. Defaults to `CORE`."
        ),

    readOnlyNodes: z
        .number()
        .int()
        .min(0)
        .max(5)
        .optional()
        .describe(
            "Number of read-only nodes (0-5), Atlas Infinite only. Read-only nodes read from the storage layer and start serving reads in minutes, without an initial sync. They use the same instance size as the electable nodes. Omit unless explicitly specified by the user."
        ),

    maxStorageGB: z
        .number()
        .int()
        .min(1)
        .max(INFINITE_MAX_STORAGE_GB)
        .optional()
        .describe(
            "Max storage limit in GB (1-131072, i.e. up to 128 TB), Atlas Infinite only. Caps the logical data size of the cluster; storage otherwise scales automatically up to 128 TB. Omit unless explicitly specified by the user."
        ),
};

const CreateClusterOutputSchema = {
    clusterId: z.string().optional(),
    provider: AtlasArgs.cloudProvider(),
    regions: z.array(z.string()),
    instanceSize: standardInstanceSizeEnum,
    clusterType: clusterTypeEnum,
    mongoDBVersion: mongoDBVersionEnum,
    backup: backupEnum,
    computeAutoScaling: z.boolean(),
    terminationProtectionEnabled: z.boolean(),
    diskSizeGB: z.number().optional(),
    encryptionAtRestProvider: encryptionAtRestProviderEnum,
    databaseEdition: databaseEditionEnum,
    readOnlyNodes: z.number().optional(),
    maxStorageGB: z.number().optional(),
};

export class CreateClusterTool extends AtlasToolBase {
    static toolName = "atlas-create-cluster";
    static operationType: OperationType = "create";
    public description =
        "Create a MongoDB Atlas cluster (M10–M80, replica set or single shard, single or multi-region). " +
        "Set databaseEdition to INFINITE to create an Atlas Infinite cluster (public preview): disaggregated compute and storage, AWS only, single region, replica set, M10-M60 instance sizes, latest MongoDB version with auto upgrades, cloud backup always enabled. " +
        "Compute autoscaling is enabled by default: min instance size is set to the selected instance size, max is set two tiers above. " +
        "Disk autoscaling is always enabled. " +
        "For encryption at rest, the CMK provider must already have a valid configuration in the Atlas project. " +
        "The tool returns immediately, use the atlas-inspect-cluster tool to poll the cluster state for readiness (state: IDLE). " +
        "Connection strings are unavailable until the cluster reaches IDLE state. " +
        "Note to LLM: Omit instance size unless specified by the user. " +
        "If provider and regions are not already known, ask for the provider and desired locations together. " +
        "Use atlas-get-regions to resolve natural-language locations or uncertain region codes before calling this tool.";
    public override outputSchema(): typeof CreateClusterOutputSchema {
        return CreateClusterOutputSchema;
    }
    public argsShape(): typeof CreateClusterArgsShape {
        return CreateClusterArgsShape;
    }

    /** Accepts the `region` argument that `regions` replaced, mapping it to a single-region cluster. */
    public override normalizeRawArgs(args: Record<string, unknown>): Record<string, unknown> {
        if (typeof args.region !== "string") {
            return args;
        }

        const { region, ...rest } = args;
        return { ...rest, regions: rest.regions ?? [region] };
    }

    protected async execute(
        args: ToolArgs<ReturnType<typeof this.argsShape>>,
        { request }: ToolExecutionContext
    ): Promise<ToolResult<ReturnType<typeof this.outputSchema>>> {
        const { projectId, clusterName, provider, regions, clusterType, terminationProtectionEnabled } = args;

        if (clusterType === "SHARDED" && (args.instanceSize === "M10" || args.instanceSize === "M20")) {
            throw new CreateClusterError("SHARDED clusters require M30 or higher instance size.");
        }

        const isInfinite = args.databaseEdition === "INFINITE";
        if (isInfinite) {
            validateInfiniteCreateArgs(args);
        } else if (args.readOnlyNodes !== undefined || args.maxStorageGB !== undefined) {
            throw new CreateClusterError(
                "readOnlyNodes and maxStorageGB are only supported when databaseEdition is INFINITE."
            );
        }

        let instanceSize: StandardInstanceSize;
        if (args.instanceSize !== undefined) {
            instanceSize = args.instanceSize;
        } else if (clusterType === "SHARDED") {
            instanceSize = "M30";
        } else {
            // REPLICASET defaults to M10 if there are less than 2 clusters in the project, M30 otherwise.
            const existing = await this.server.apiClient.listClusters(
                { params: { path: { groupId: projectId } } },
                request
            );
            instanceSize = (existing.results?.length ?? 0) < 2 ? "M10" : "M30";
        }

        const autoScaling = isInfinite
            ? buildAutoScaling({
                  instanceSize,
                  computeEnabled: args.computeAutoScaling,
                  provider,
                  // validateInfiniteCreateArgs rejected sizes above M60 already.
                  maxInstanceSize: getInfiniteMaxAutoScalingSize(instanceSize as InfiniteInstanceSize),
              })
            : buildAutoScaling({ instanceSize, computeEnabled: args.computeAutoScaling, provider });

        const replicationSpecs = isInfinite
            ? buildInfiniteReplicationSpecs({
                  provider,
                  // Single region, enforced by validateInfiniteCreateArgs.
                  region: regions[0] as string,
                  instanceSize,
                  autoScaling,
                  readOnlyNodes: args.readOnlyNodes ?? 0,
                  maxStorageGB: args.maxStorageGB,
              })
            : buildReplicationSpecs({
                  provider,
                  regions,
                  instanceSize,
                  autoScaling,
                  diskSizeGB: args.diskSizeGB,
              });
        const backupConfig = buildBackupConfig(args.backup);
        const versionConfig = buildVersionConfig(args.mongoDBVersion);

        let encryptionAtRestProvider = args.encryptionAtRestProvider;
        if (encryptionAtRestProvider === undefined) {
            const validConfigExists = await this.doesValidEARConfigExist({ provider, projectId, request });
            encryptionAtRestProvider = validConfigExists ? provider : "NONE";
        }

        const body = {
            name: clusterName,
            clusterType,
            replicationSpecs,
            terminationProtectionEnabled,
            ...backupConfig,
            ...versionConfig,
            encryptionAtRestProvider,
            // Only set for Infinite: Core keeps the API default and stays byte-identical to previous tool behavior.
            ...(isInfinite && { databaseEdition: "INFINITE" as const }),
        } as unknown as ClusterDescription20240805;

        const ipAccessListResult = await ensureCurrentIpInAccessList({
            apiClient: this.server.apiClient,
            projectId,
            context: request,
        });

        const result = await this.server.apiClient.createCluster(
            {
                params: { path: { groupId: projectId } },
                body,
            },
            request
        );

        const ipAccessListNote = getAccessListNote(ipAccessListResult);

        return {
            content: [
                {
                    type: "text",
                    text:
                        `Cluster "${clusterName}" is being created in project "${projectId}" (${isInfinite ? "Atlas Infinite" : `${instanceSize} ${clusterType} on ${provider}/${regions.join(", ")}`}). ` +
                        `Use the atlas-inspect-cluster tool with projectId "${projectId}" and clusterName "${clusterName}" to poll for readiness. ` +
                        `The cluster is ready when its state is IDLE, connection strings are unavailable until then.`,
                },
                ...(ipAccessListNote ? [{ type: "text" as const, text: ipAccessListNote }] : []),
            ],
            structuredContent: {
                clusterId: result.id,
                provider,
                regions,
                instanceSize,
                clusterType,
                mongoDBVersion: args.mongoDBVersion,
                backup: args.backup,
                computeAutoScaling: args.computeAutoScaling,
                terminationProtectionEnabled,
                diskSizeGB: args.diskSizeGB,
                encryptionAtRestProvider,
                databaseEdition: args.databaseEdition,
                readOnlyNodes: args.readOnlyNodes,
                maxStorageGB: args.maxStorageGB,
            },
        };
    }

    protected async doesValidEARConfigExist({
        provider,
        projectId,
        request,
    }: {
        provider: AtlasCloudProvider;
        projectId: string;
        request: ToolRequest<IAtlasConfig>;
    }): Promise<boolean> {
        try {
            const encryptionAtRest = await this.server.apiClient.getEncryptionAtRest(
                { params: { path: { groupId: projectId } } },
                request
            );

            let config;
            switch (provider) {
                case "AWS":
                    config = encryptionAtRest.awsKms;
                    break;
                case "AZURE":
                    config = encryptionAtRest.azureKeyVault;
                    break;
                case "GCP":
                    config = encryptionAtRest.googleCloudKms;
                    break;
            }

            return config?.enabled === true && config.valid === true;
        } catch (error) {
            // If no permissions to fetch EAR configs, assume no valid configs and don't set any default.
            if (error instanceof ApiClientError && error.response.status === 403) {
                return false;
            }
            throw error;
        }
    }

    protected override handleError(error: unknown, args: ToolArgs<ReturnType<typeof this.argsShape>>): CallToolResult {
        if (error instanceof CreateClusterError) {
            return {
                content: [{ type: "text", text: error.message }],
                isError: true,
            };
        }
        return super.handleError(error, args) as CallToolResult;
    }

    protected override async resolveTelemetryMetadata(
        args: ToolArgs<ReturnType<typeof this.argsShape>>,
        context: { result: CallToolResult }
    ): Promise<CreateClusterMetadata> {
        const parentMetadata = await super.resolveTelemetryMetadata(args, context);
        type Output = z.infer<z.ZodObject<typeof CreateClusterOutputSchema>>;
        const sc = context.result.structuredContent as Output | undefined;
        return {
            ...parentMetadata,
            cluster_id: sc?.clusterId,
            provider: sc?.provider,
            regions: sc?.regions,
            instance_size: sc?.instanceSize,
            cluster_type: sc?.clusterType,
            backup: sc?.backup,
            compute_auto_scaling: sc !== undefined ? (sc.computeAutoScaling ? "true" : "false") : undefined,
            termination_protection: sc !== undefined ? (sc.terminationProtectionEnabled ? "true" : "false") : undefined,
            disk_size_gb: sc?.diskSizeGB,
            mongodb_version: sc?.mongoDBVersion,
            encryption_at_rest_provider: sc?.encryptionAtRestProvider,
            database_edition: sc?.databaseEdition,
        };
    }
}
