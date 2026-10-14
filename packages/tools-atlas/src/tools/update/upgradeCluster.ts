import { z } from "zod";
import { type ToolArgs, type ToolResult, ToolArgumentValidationError } from "@mongodb-js/mcp-core";
import type { OperationType, ToolExecutionContext, ToolRequest, CallToolResult } from "@mongodb-js/mcp-types";
import { AtlasToolBase, type IAtlasConfig } from "../../atlasTool.js";
import { formatCluster } from "../../helpers/cluster.js";
import type { ApiClient } from "@mongodb-js/mcp-atlas-api-client";
import { ApiClientError } from "@mongodb-js/mcp-atlas-api-client";
import type { ClusterDescription20240805 } from "@mongodb-js/mcp-atlas-api-client";
import { AtlasArgs } from "../../args.js";
import {
    standardInstanceSizeEnum,
    getMaxAutoScalingSize,
    getInfiniteMaxAutoScalingSize,
    databaseEditionEnum,
    type DatabaseEdition,
    type StandardInstanceSize,
} from "../../helpers/cluster.js";
import type { UpgradeClusterMetadata } from "@mongodb-js/mcp-atlas-telemetry";

const ALLOWED_PROVIDER_REGEX = /^[A-Z_]+$/;

// Adds M140/M200 since getMaxAutoScalingSize can return those for M60/M80, and maxInstanceSize accepts them directly.
const INSTANCE_SIZE_ORDER = [...standardInstanceSizeEnum.options, "M140", "M200"];

function isHigherInstanceSize(a: string, b: string): boolean {
    return INSTANCE_SIZE_ORDER.indexOf(a) > INSTANCE_SIZE_ORDER.indexOf(b);
}

// maxInstanceSize can go beyond standardInstanceSizeEnum since autoscaling may grow an M60/M80 cluster past M80.
const maxAutoScalingSizeEnum = z.enum([...standardInstanceSizeEnum.options, "M140", "M200"]);

// Atlas Infinite HA shards are one primary plus one standby node.
const INFINITE_ELECTABLE_NODE_COUNT = 2;

// Hardcoded defaults for all dedicated (M10) upgrade paths.
// provider and region are the only fields callers may override.
const DEDICATED_CLUSTER_DEFAULTS = {
    clusterType: "REPLICASET",
    regionConfig: {
        priority: 7,
        electableSpecs: {
            instanceSize: "M10",
            nodeCount: 3,
        },
    },
} as const;

type FreeUpgradeBody = {
    name: string;
    databaseEdition?: "INFINITE";
    providerSettings: {
        providerName?: string;
        instanceSizeName: string;
        regionName?: string;
        autoScaling?: { compute?: { minInstanceSize?: string; maxInstanceSize?: string } };
    };
    autoScaling: {
        compute: { enabled: boolean; scaleDownEnabled: boolean };
        diskGBEnabled: boolean;
    };
};

type FlexUpgradeBody = {
    name: string;
    clusterType: "REPLICASET";
    databaseEdition?: "INFINITE";
    replicationSpecs: Array<{
        regionConfigs: Array<{
            providerName?: string;
            regionName?: string;
            priority: number;
            electableSpecs: { instanceSize: string; nodeCount: number };
            autoScaling: {
                compute: {
                    enabled: boolean;
                    scaleDownEnabled: boolean;
                    minInstanceSize?: string;
                    maxInstanceSize?: string;
                };
                diskGB: { enabled: boolean };
            };
        }>;
    }>;
};

type AutoScalingArgs = { computeAutoScaling?: boolean; minInstanceSize?: string; maxInstanceSize?: string };

type ResolvedM10AutoScaling = { enabled: boolean; minInstanceSize?: string; maxInstanceSize?: string };

// Validates and resolves the autoscaling args for a Free/Flex to M10 upgrade, where the target size is fixed at M10.
function resolveM10AutoScaling(autoScalingArgs: AutoScalingArgs, provider: string | undefined): ResolvedM10AutoScaling {
    if (autoScalingArgs.minInstanceSize !== undefined && autoScalingArgs.minInstanceSize !== "M10") {
        throw new UpgradeClusterError(`minInstanceSize must be omitted or "M10" when upgrading to M10 Dedicated.`);
    }

    const enabled = autoScalingArgs.computeAutoScaling ?? true;
    if (!enabled) {
        return {
            enabled,
            minInstanceSize: autoScalingArgs.minInstanceSize,
            maxInstanceSize: autoScalingArgs.maxInstanceSize,
        };
    }
    return {
        enabled,
        minInstanceSize: autoScalingArgs.minInstanceSize ?? "M10",
        maxInstanceSize: autoScalingArgs.maxInstanceSize ?? getMaxAutoScalingSize("M10", provider ?? ""),
    };
}

// Builds the tenantUpgrade request body for a Free or Flex source cluster.
// targetSize defaults to M10 (Atlas Core Dedicated); edition INFINITE targets
// an Atlas Infinite cluster, which uses 2 electable nodes per HA shard.
function buildM10UpgradeBody({
    baseTier,
    clusterName,
    autoScaling,
    provider,
    region,
    targetSize = "M10",
    edition = "CORE",
}: {
    baseTier: "FREE" | "FLEX";
    clusterName: string;
    autoScaling: ResolvedM10AutoScaling;
    provider?: string;
    region?: string;
    targetSize?: string;
    edition?: DatabaseEdition;
}): FreeUpgradeBody | FlexUpgradeBody {
    const { enabled, minInstanceSize, maxInstanceSize } = autoScaling;

    if (baseTier === "FREE") {
        return {
            name: clusterName,
            ...(edition === "INFINITE" && { databaseEdition: "INFINITE" as const }),
            providerSettings: {
                ...(provider !== undefined && { providerName: provider }),
                instanceSizeName: targetSize,
                ...(region !== undefined && { regionName: region }),
                ...(enabled && { autoScaling: { compute: { minInstanceSize, maxInstanceSize } } }),
            },
            autoScaling: {
                compute: { enabled, scaleDownEnabled: enabled },
                diskGBEnabled: true,
            },
        };
    }
    return {
        name: clusterName,
        clusterType: DEDICATED_CLUSTER_DEFAULTS.clusterType,
        ...(edition === "INFINITE" && { databaseEdition: "INFINITE" as const }),
        replicationSpecs: [
            {
                regionConfigs: [
                    {
                        ...(provider !== undefined && { providerName: provider }),
                        ...(region !== undefined && { regionName: region }),
                        priority: DEDICATED_CLUSTER_DEFAULTS.regionConfig.priority,
                        electableSpecs: {
                            instanceSize: targetSize,
                            nodeCount: edition === "INFINITE" ? INFINITE_ELECTABLE_NODE_COUNT : 3,
                        },
                        autoScaling: {
                            compute: { enabled, scaleDownEnabled: enabled, minInstanceSize, maxInstanceSize },
                            diskGB: { enabled: true },
                        },
                    },
                ],
            },
        ],
    };
}

// Validates and resolves the autoscaling args for a Free/Flex to Atlas Infinite upgrade.
// Explicit bounds pass through to the API (which enforces the M10-M60 preview cap);
// the default max comes from getInfiniteMaxAutoScalingSize.
function resolveInfiniteUpgradeAutoScaling({
    autoScalingArgs,
    targetSize,
    provider,
}: {
    autoScalingArgs: AutoScalingArgs;
    targetSize: StandardInstanceSize;
    provider: string | undefined;
}): ResolvedM10AutoScaling {
    const { minInstanceSize, maxInstanceSize } = autoScalingArgs;

    const enabled = autoScalingArgs.computeAutoScaling ?? true;
    if (!enabled) {
        return {
            enabled,
            minInstanceSize,
            maxInstanceSize,
        };
    }

    const min = minInstanceSize ?? targetSize;
    const max = maxInstanceSize ?? getInfiniteMaxAutoScalingSize(targetSize, provider ?? "");
    if (isHigherInstanceSize(min, max)) {
        throw new UpgradeClusterError(`minInstanceSize "${min}" cannot be higher than maxInstanceSize "${max}".`);
    }
    return { enabled, minInstanceSize: min, maxInstanceSize: max };
}

type ResolvedClusterInfo = {
    instanceType: "FREE" | "FLEX" | "DEDICATED";
    provider?: string;
    region?: string;
    raw?: ClusterDescription20240805;
    instanceSize?: string;
    databaseEdition?: DatabaseEdition;
};

async function resolveClusterInfo({
    apiClient,
    projectId,
    clusterName,
    argOverrides,
    request,
}: {
    apiClient: Pick<ApiClient, "getCluster" | "getFlexCluster">;
    projectId: string;
    clusterName: string;
    argOverrides: { provider?: string; region?: string };
    request: ToolRequest<IAtlasConfig>;
}): Promise<ResolvedClusterInfo> {
    try {
        const raw = await apiClient.getCluster({ params: { path: { groupId: projectId, clusterName } } }, request);
        const cluster = formatCluster(raw);
        return {
            instanceType: cluster.instanceType,
            provider: argOverrides.provider ?? cluster.provider,
            region: argOverrides.region ?? cluster.region,
            raw,
            instanceSize: cluster.instanceSize,
            databaseEdition: cluster.databaseEdition,
        };
    } catch (err) {
        // Atlas returns 400 for Flex clusters on the regular cluster endpoint ("cannot be used in the Cluster API")
        // and 404 when the cluster simply doesn't exist. Both signal "try the flex endpoint instead".
        if (!(err instanceof ApiClientError) || (err.response.status !== 404 && err.response.status !== 400)) {
            throw err;
        }
        const raw = await apiClient.getFlexCluster(
            { params: { path: { groupId: projectId, name: clusterName } } },
            request
        );
        return {
            instanceType: "FLEX",
            provider: argOverrides.provider ?? raw.providerSettings?.backingProviderName,
            region: argOverrides.region ?? raw.providerSettings?.regionName,
        };
    }
}

type ComputeAutoScaling = {
    enabled: boolean;
    scaleDownEnabled: boolean;
    minInstanceSize?: string;
    maxInstanceSize?: string;
};

type ScaleRegionConfig = {
    electableSpecs?: { instanceSize: string } & Record<string, unknown>;
    readOnlySpecs?: { instanceSize: string } & Record<string, unknown>;
    autoScaling?: { compute: ComputeAutoScaling; diskGB?: { enabled: boolean } };
} & Record<string, unknown>;

type ScaleClusterBody = {
    replicationSpecs: Array<{ regionConfigs: ScaleRegionConfig[] } & Record<string, unknown>>;
};

function buildScaleClusterBody({
    raw,
    targetSize,
    compute,
}: {
    raw: ClusterDescription20240805 | undefined;
    targetSize: string;
    compute: ComputeAutoScaling;
}): ScaleClusterBody {
    const replicationSpecs = (raw?.replicationSpecs ?? []).map((spec) => {
        const regionConfigs = ((spec.regionConfigs ?? []) as Array<Record<string, unknown>>).map((rc) => {
            const electableSpecs = rc.electableSpecs as Record<string, unknown> | undefined;
            const readOnlySpecs = rc.readOnlySpecs as Record<string, unknown> | undefined;
            if (!electableSpecs && !readOnlySpecs) {
                return { ...rc };
            }
            const existingAutoScaling = rc.autoScaling as { diskGB?: { enabled: boolean } } | undefined;
            return {
                ...rc,
                ...(electableSpecs && { electableSpecs: { ...electableSpecs, instanceSize: targetSize } }),
                ...(readOnlySpecs && { readOnlySpecs: { ...readOnlySpecs, instanceSize: targetSize } }),
                autoScaling: {
                    compute: { ...compute },
                    ...(existingAutoScaling?.diskGB !== undefined && { diskGB: existingAutoScaling.diskGB }),
                },
            };
        });
        return { ...spec, regionConfigs };
    }) as ScaleClusterBody["replicationSpecs"];

    return { replicationSpecs };
}

class UpgradeClusterError extends ToolArgumentValidationError {}

type DedicatedScalingArgs = {
    targetTier?: string;
    computeAutoScaling?: boolean;
    minInstanceSize?: string;
    maxInstanceSize?: string;
    provider?: string;
    region?: string;
};

type CurrentAutoScaling = { enabled?: boolean; minInstanceSize?: string; maxInstanceSize?: string };

// Validates that a DEDICATED cluster can be safely scaled, and returns its current autoscaling
// settings (read from the first region, already confirmed consistent across all regions below).
function validateDedicatedScaling({
    clusterInfo,
    args,
    clusterName,
}: {
    clusterInfo: ResolvedClusterInfo;
    args: DedicatedScalingArgs;
    clusterName: string;
}): CurrentAutoScaling | undefined {
    if (args.targetTier === "FLEX") {
        throw new UpgradeClusterError(
            `Cluster "${clusterName}" is already Dedicated. targetTier must be an instance size (M10-M80) to scale it in place, not FLEX.`
        );
    }
    if (args.provider !== undefined || args.region !== undefined) {
        throw new UpgradeClusterError(
            `Invalid Arguments:provider/region. provider/region are not valid when scaling an already-Dedicated cluster "${clusterName}".`
        );
    }
    if (
        args.targetTier === undefined &&
        args.computeAutoScaling === undefined &&
        args.minInstanceSize === undefined &&
        args.maxInstanceSize === undefined
    ) {
        throw new UpgradeClusterError(
            `No changes specified for Dedicated cluster "${clusterName}". Provide targetTier (new instance size), computeAutoScaling, minInstanceSize, and/or maxInstanceSize to scale it.`
        );
    }
    if (!standardInstanceSizeEnum.safeParse(clusterInfo.instanceSize).success) {
        throw new UpgradeClusterError(
            `Cluster "${clusterName}" has instance size "${clusterInfo.instanceSize ?? "unknown"}", which this tool does not support scaling. Only standard M10-M80 instance sizes are supported.`
        );
    }
    const clusterType = clusterInfo.raw?.clusterType;
    if (
        (clusterType !== "REPLICASET" && clusterType !== "SHARDED") ||
        (clusterInfo.raw?.replicationSpecs?.length ?? 0) > 1
    ) {
        throw new UpgradeClusterError(
            `Cluster "${clusterName}" is a ${clusterType ?? "unrecognized"} cluster, which this tool does not support scaling. Only single-shard clusters (REPLICASET, or SHARDED with one shard) are supported.`
        );
    }
    const regionConfigs = (clusterInfo.raw?.replicationSpecs?.[0]?.regionConfigs ?? []) as Array<{
        electableSpecs?: { instanceSize?: string };
        readOnlySpecs?: { instanceSize?: string };
        autoScaling?: { compute?: CurrentAutoScaling };
    }>;
    const electableSizes = regionConfigs
        .map((rc) => rc.electableSpecs?.instanceSize)
        .filter((size): size is string => size !== undefined);
    const readOnlySizes = regionConfigs
        .map((rc) => rc.readOnlySpecs?.instanceSize)
        .filter((size): size is string => size !== undefined);
    if (new Set(electableSizes).size > 1 || new Set(readOnlySizes).size > 1) {
        throw new UpgradeClusterError(
            `Cluster "${clusterName}" has regions with different instance sizes, which this tool does not support scaling to avoid unintended changes.`
        );
    }
    return regionConfigs[0]?.autoScaling?.compute;
}

// Validates and resolves the upgrade target for a Free/Flex source cluster.
// Atlas Core upgrades keep the previous behavior (FLEX or M10). Targeting
// Atlas Infinite defaults to M10 and passes other instance sizes through to
// the API, which enforces the M10-M60 preview cap.
function resolveNonDedicatedTarget(
    args: { targetTier?: "FLEX" | StandardInstanceSize; targetEdition?: DatabaseEdition },
    instanceType: "FREE" | "FLEX"
): { tier: StandardInstanceSize; edition: "INFINITE" } | { tier: "FLEX" | "M10"; edition: "CORE" } {
    if (args.targetEdition === "INFINITE") {
        if (args.targetTier === "FLEX") {
            throw new UpgradeClusterError(
                `targetTier "FLEX" is not valid when targetEdition is INFINITE. Omit targetTier or choose an instance size.`
            );
        }
        return { tier: args.targetTier ?? "M10", edition: "INFINITE" };
    }
    if (args.targetTier !== undefined && args.targetTier !== "FLEX" && args.targetTier !== "M10") {
        throw new UpgradeClusterError(
            `targetTier "${args.targetTier}" is not valid when upgrading from ${instanceType}. Choose FLEX or M10 - larger instance sizes are only valid once the cluster is already Dedicated.`
        );
    }
    return { tier: args.targetTier ?? (instanceType === "FREE" ? "FLEX" : "M10"), edition: "CORE" };
}

export const UpgradeClusterOutputSchema = {
    originalTier: z.enum(["FREE", "FLEX", ...standardInstanceSizeEnum.options]),
    targetTier: z.enum(["FLEX", ...standardInstanceSizeEnum.options]),
    databaseEdition: databaseEditionEnum.optional(),
    computeAutoScaling: z.boolean().optional(),
    minInstanceSize: z.string().optional(),
    maxInstanceSize: z.string().optional(),
    resolvedProvider: z.string().optional(),
    resolvedRegion: z.string().optional(),
    clusterId: z.string().optional(),
};

const UpgradeClusterArgsShape = {
    projectId: AtlasArgs.projectId().describe("Atlas project ID"),
    clusterName: AtlasArgs.clusterName().describe("Name of the cluster to upgrade"),
    targetTier: z
        .enum(["FLEX", ...standardInstanceSizeEnum.options])
        .optional()
        .describe(
            "For a Free/Flex source cluster: the target tier to upgrade to. Defaults to FLEX for Free clusters, M10 for Flex clusters; when targetEdition is INFINITE, any M10-M60 size can be selected (defaults to M10). " +
                "For a Dedicated cluster: the new instance size (M10-M80) to scale it to."
        ),
    targetEdition: databaseEditionEnum
        .optional()
        .describe(
            "Database edition to upgrade to. `INFINITE` upgrades a Free or Flex cluster to an Atlas Infinite cluster (public preview, AWS only, M10-M60). " +
                "Cannot be changed on a Dedicated cluster: Atlas Core clusters cannot be upgraded to Atlas Infinite and vice versa. " +
                "Omit to keep the cluster's current edition."
        ),
    computeAutoScaling: z
        .boolean()
        .optional()
        .describe(
            "Enable/disable compute autoscaling, for a Dedicated cluster or a Free/Flex-to-M10 upgrade. Omit unless explicitly specified by the user."
        ),
    minInstanceSize: standardInstanceSizeEnum
        .optional()
        .describe(
            "Minimum instance size (M10-M80) for compute autoscaling, for a Dedicated cluster or a Free/Flex-to-M10 upgrade. Omit unless explicitly specified by the user."
        ),
    maxInstanceSize: maxAutoScalingSizeEnum
        .optional()
        .describe(
            "Maximum instance size (M10-M200) for compute autoscaling, for a Dedicated cluster or a Free/Flex-to-M10 upgrade. Omit unless explicitly specified by the user."
        ),
    provider: z
        .string()
        .regex(ALLOWED_PROVIDER_REGEX, "Provider must be uppercase letters and underscores only")
        .optional()
        .describe(
            "Cloud provider (e.g. AWS, GCP, AZURE) for a Free/Flex source cluster. Preserves the existing value if omitted. Does not apply if a cluster is already Dedicated."
        ),
    region: AtlasArgs.region()
        .optional()
        .describe(
            "Cloud provider region in Atlas format using uppercase letters and underscores (e.g. US_EAST_1) for a Free/Flex source cluster. Preserves the existing value if omitted. Does not apply if a cluster is already Dedicated."
        ),
};

export class UpgradeClusterTool extends AtlasToolBase {
    static toolName = "atlas-upgrade-cluster";
    public description =
        "Upgrade or scale a MongoDB Atlas cluster. Free and Flex clusters can be upgraded to Flex, M10 Dedicated, or Atlas Infinite (set targetEdition to INFINITE). Dedicated clusters can be scaled to a different instance size, and compute autoscaling settings can be updated. " +
        "When scaling a Dedicated cluster, at least one of targetTier, computeAutoScaling, minInstanceSize, or maxInstanceSize must be provided. " +
        "Compute autoscaling defaults to enabled when upgrading to M10 Dedicated: min instance size is set to the selected instance size, max is set two tiers above, unless overridden. " +
        "Note to LLM: If provider and region are not already known, ask for both together in a single question before calling this tool. " +
        "Use atlas-get-regions to resolve natural-language locations or uncertain region codes before calling this tool.";
    static operationType: OperationType = "update";
    public override outputSchema(): typeof UpgradeClusterOutputSchema {
        return UpgradeClusterOutputSchema;
    }
    public argsShape(): typeof UpgradeClusterArgsShape {
        return UpgradeClusterArgsShape;
    }

    protected async execute(
        args: ToolArgs<ReturnType<typeof this.argsShape>>,
        { request }: ToolExecutionContext
    ): Promise<ToolResult<ReturnType<typeof this.outputSchema>>> {
        const { projectId, clusterName } = args;

        const clusterInfo = await resolveClusterInfo({
            apiClient: this.server.apiClient,
            projectId,
            clusterName,
            argOverrides: { provider: args.provider, region: args.region },
            request,
        });

        let clusterId: string | undefined;
        let targetInstanceSize: string | undefined;
        let targetEdition: DatabaseEdition | undefined;
        let computeAutoScaling: boolean | undefined;
        let minInstanceSize: string | undefined;
        let maxInstanceSize: string | undefined;
        let isScaling = false;
        let target: string | undefined;

        switch (clusterInfo.instanceType) {
            case "DEDICATED": {
                if (args.targetEdition !== undefined) {
                    const currentEdition = clusterInfo.databaseEdition ?? "CORE";
                    if (currentEdition === "INFINITE" && args.targetEdition === "CORE") {
                        throw new UpgradeClusterError(
                            `Cluster "${clusterName}" is an Atlas Infinite cluster. Clusters cannot change their database edition.`
                        );
                    }
                    if (currentEdition === "CORE" && args.targetEdition === "INFINITE") {
                        throw new UpgradeClusterError(
                            `Cluster "${clusterName}" is an Atlas Core cluster. Upgrading an Atlas Core cluster to Atlas Infinite is not supported; create a new Atlas Infinite cluster with the atlas-create-cluster tool instead.`
                        );
                    }
                }

                const currentAutoScaling = validateDedicatedScaling({ clusterInfo, args, clusterName });

                // Target size: an explicit resize, or unchanged if only autoscaling is being adjusted.
                let resolvedInstanceSize: StandardInstanceSize;
                if (args.targetTier !== undefined) {
                    // validateDedicatedScaling already rejected "FLEX" here.
                    resolvedInstanceSize = args.targetTier as StandardInstanceSize;
                } else {
                    resolvedInstanceSize = clusterInfo.instanceSize as StandardInstanceSize;
                }

                isScaling = resolvedInstanceSize !== clusterInfo.instanceSize;

                // Whether autoscaling should be enabled: explicit override, else the cluster's current setting.
                const resolvedEnabled = args.computeAutoScaling ?? currentAutoScaling?.enabled ?? false;

                // Autoscaling min bound.
                let resolvedMin: string | undefined;
                if (args.minInstanceSize !== undefined) {
                    // Explicit override always wins.
                    resolvedMin = args.minInstanceSize;
                } else if (!resolvedEnabled) {
                    // Autoscaling disabled: no min needed.
                    resolvedMin = undefined;
                } else if (isScaling) {
                    // Resizing without an explicit min: reset relative to the new size.
                    resolvedMin = resolvedInstanceSize;
                } else {
                    // Not resizing: keep the cluster's current min, falling back to the new size if autoscaling wasn't already configured.
                    resolvedMin = currentAutoScaling?.minInstanceSize ?? resolvedInstanceSize;
                }

                // Two tiers above the new size; Infinite clusters clamp the derived default to M60.
                const defaultMax =
                    clusterInfo.databaseEdition === "INFINITE"
                        ? getInfiniteMaxAutoScalingSize(resolvedInstanceSize, clusterInfo.provider ?? "")
                        : getMaxAutoScalingSize(resolvedInstanceSize, clusterInfo.provider ?? "");

                // Autoscaling max bound.
                let resolvedMax: string | undefined;
                if (args.maxInstanceSize !== undefined) {
                    // Explicit override always wins.
                    resolvedMax = args.maxInstanceSize;
                } else if (!resolvedEnabled) {
                    // Autoscaling disabled: no max needed.
                    resolvedMax = undefined;
                } else if (isScaling) {
                    // Resizing without an explicit max: use the default, unless the cluster's existing max was already higher.
                    const existingMax = currentAutoScaling?.maxInstanceSize;
                    resolvedMax =
                        existingMax !== undefined && isHigherInstanceSize(existingMax, defaultMax)
                            ? existingMax
                            : defaultMax;
                } else {
                    // Not resizing: keep the cluster's current max, falling back to the default if autoscaling wasn't already configured.
                    resolvedMax = currentAutoScaling?.maxInstanceSize ?? defaultMax;
                }

                if (
                    resolvedEnabled &&
                    resolvedMin !== undefined &&
                    resolvedMax !== undefined &&
                    isHigherInstanceSize(resolvedMin, resolvedMax)
                ) {
                    throw new UpgradeClusterError(
                        `minInstanceSize "${resolvedMin}" cannot be higher than maxInstanceSize "${resolvedMax}".`
                    );
                }

                const body = buildScaleClusterBody({
                    raw: clusterInfo.raw,
                    targetSize: resolvedInstanceSize,
                    compute: {
                        enabled: resolvedEnabled,
                        scaleDownEnabled: resolvedEnabled,
                        minInstanceSize: resolvedMin,
                        maxInstanceSize: resolvedMax,
                    },
                });

                const result = await this.server.apiClient.updateCluster(
                    {
                        params: { path: { groupId: projectId, clusterName } },
                        body: body as unknown as ClusterDescription20240805,
                    },
                    request
                );
                clusterId = result.id;
                targetInstanceSize = resolvedInstanceSize;
                targetEdition = clusterInfo.databaseEdition ?? "CORE";
                computeAutoScaling = resolvedEnabled;
                minInstanceSize = resolvedMin;
                maxInstanceSize = resolvedMax;
                break;
            }
            case "FLEX": {
                const resolved = resolveNonDedicatedTarget(args, "FLEX");
                target = resolved.tier;
                if (resolved.tier === "FLEX") {
                    throw new UpgradeClusterError(`Cluster "${clusterName}" is already a Flex cluster.`);
                }

                const isInfiniteUpgrade = resolved.edition === "INFINITE";
                const resolvedAutoScaling = isInfiniteUpgrade
                    ? resolveInfiniteUpgradeAutoScaling({
                          autoScalingArgs: args,
                          targetSize: resolved.tier,
                          provider: clusterInfo.provider,
                      })
                    : resolveM10AutoScaling(args, clusterInfo.provider);

                // tenantUpgrade: upgrades Flex clusters to Dedicated (M10+) or Atlas Infinite
                ({ id: clusterId } = await this.server.apiClient.tenantUpgrade(
                    {
                        params: { path: { groupId: projectId } },
                        body: buildM10UpgradeBody({
                            baseTier: "FLEX",
                            clusterName,
                            autoScaling: resolvedAutoScaling,
                            provider: clusterInfo.provider,
                            region: clusterInfo.region,
                            ...(isInfiniteUpgrade && {
                                targetSize: resolved.tier,
                                edition: "INFINITE",
                            }),
                        }),
                    } as unknown as Parameters<typeof this.server.apiClient.tenantUpgrade>[0],
                    request
                ));
                targetEdition = resolved.edition;
                break;
            }
            case "FREE": {
                const resolved = resolveNonDedicatedTarget(args, "FREE");
                target = resolved.tier;
                if (
                    resolved.tier === "FLEX" &&
                    (args.computeAutoScaling !== undefined ||
                        args.minInstanceSize !== undefined ||
                        args.maxInstanceSize !== undefined)
                ) {
                    throw new UpgradeClusterError(
                        `Invalid Arguments:computeAutoScaling/minInstanceSize/maxInstanceSize. Flex clusters do not support compute autoscaling.`
                    );
                }

                const isInfiniteUpgrade = resolved.edition === "INFINITE";
                const resolvedAutoScaling = isInfiniteUpgrade
                    ? resolveInfiniteUpgradeAutoScaling({
                          autoScalingArgs: args,
                          targetSize: resolved.tier,
                          provider: clusterInfo.provider,
                      })
                    : resolveM10AutoScaling(args, clusterInfo.provider);

                ({ id: clusterId } = await this.upgradeFreeCluster({
                    projectId,
                    clusterName,
                    target: resolved.tier,
                    edition: resolved.edition,
                    backingProviderName: clusterInfo.provider,
                    regionName: clusterInfo.region,
                    autoScaling: resolvedAutoScaling,
                    request,
                }));
                targetEdition = resolved.edition;
                break;
            }
        }

        if (clusterInfo.instanceType === "DEDICATED") {
            const isAutoscaling =
                args.computeAutoScaling !== undefined ||
                args.minInstanceSize !== undefined ||
                args.maxInstanceSize !== undefined;
            const autoScalingSummary = computeAutoScaling
                ? `compute autoscaling enabled (${minInstanceSize}-${maxInstanceSize})`
                : "compute autoscaling disabled";

            let text: string;
            if (isScaling && isAutoscaling) {
                text = `Cluster "${clusterName}" is being scaled to ${targetInstanceSize} with ${autoScalingSummary}. This may take a few minutes.`;
            } else if (isScaling) {
                text = `Cluster "${clusterName}" is being scaled to ${targetInstanceSize}. This may take a few minutes.`;
            } else if (isAutoscaling) {
                text = `Cluster "${clusterName}" is being updated with ${autoScalingSummary}. This may take a few minutes.`;
            } else {
                text = `Cluster "${clusterName}" is being updated. This may take a few minutes.`;
            }

            return {
                content: [
                    {
                        type: "text",
                        text,
                    },
                ],
                structuredContent: {
                    originalTier: clusterInfo.instanceSize as StandardInstanceSize,
                    targetTier: targetInstanceSize as StandardInstanceSize,
                    databaseEdition: targetEdition,
                    computeAutoScaling,
                    minInstanceSize,
                    maxInstanceSize,
                    resolvedProvider: clusterInfo.provider,
                    resolvedRegion: clusterInfo.region,
                    clusterId,
                },
            };
        }

        const isAutoscaling =
            args.computeAutoScaling !== undefined ||
            args.minInstanceSize !== undefined ||
            args.maxInstanceSize !== undefined;
        const targetLabel = targetEdition === "INFINITE" ? `Atlas Infinite (${target} tier)` : `${target} tier`;

        return {
            content: [
                {
                    type: "text",
                    text: isAutoscaling
                        ? `Cluster "${clusterName}" is being upgraded from ${clusterInfo.instanceType} to ${targetLabel} with compute autoscaling ${computeAutoScaling ? `enabled (${minInstanceSize}-${maxInstanceSize})` : "disabled"}. This may take a few minutes.`
                        : `Cluster "${clusterName}" is being upgraded from ${clusterInfo.instanceType} to ${targetLabel}. This may take a few minutes.`,
                },
            ],
            structuredContent: {
                originalTier: clusterInfo.instanceType,
                targetTier: target as "FLEX" | StandardInstanceSize,
                databaseEdition: targetEdition,
                resolvedProvider: clusterInfo.provider,
                resolvedRegion: clusterInfo.region,
                clusterId,
            },
        };
    }

    protected override handleError(error: unknown, args: ToolArgs<ReturnType<typeof this.argsShape>>): CallToolResult {
        if (error instanceof UpgradeClusterError) {
            return {
                content: [{ type: "text", text: error.message }],
                isError: true,
            };
        }

        return super.handleError(error, args) as CallToolResult;
    }

    private async upgradeFreeCluster({
        projectId,
        clusterName,
        target,
        edition,
        backingProviderName,
        regionName,
        autoScaling,
        request,
    }: {
        projectId: string;
        clusterName: string;
        target: string;
        edition: DatabaseEdition;
        backingProviderName: string | undefined;
        regionName: string | undefined;
        autoScaling: ResolvedM10AutoScaling;
        request: ToolRequest<IAtlasConfig>;
    }): Promise<{ id?: string }> {
        // upgradeTenantUpgrade: upgrades Free (M0/shared) clusters to Flex or Dedicated (M10+)
        switch (target) {
            case "FLEX":
                return await this.server.apiClient.upgradeTenantUpgrade(
                    {
                        params: { path: { groupId: projectId } },
                        body: {
                            name: clusterName,
                            providerSettings: {
                                providerName: "FLEX",
                                instanceSizeName: "FLEX",
                                ...(backingProviderName !== undefined && { backingProviderName }),
                                ...(regionName !== undefined && { regionName }),
                            },
                        },
                    } as unknown as Parameters<typeof this.server.apiClient.upgradeTenantUpgrade>[0],
                    request
                );
            default: {
                // M10 (Atlas Core Dedicated), or any M10-M60 size when targeting Atlas Infinite.
                return await this.server.apiClient.upgradeTenantUpgrade(
                    {
                        params: { path: { groupId: projectId } },
                        body: buildM10UpgradeBody({
                            baseTier: "FREE",
                            clusterName,
                            autoScaling,
                            provider: backingProviderName,
                            region: regionName,
                            ...(edition === "INFINITE" && {
                                targetSize: target,
                                edition: "INFINITE",
                            }),
                        }),
                    } as unknown as Parameters<typeof this.server.apiClient.upgradeTenantUpgrade>[0],
                    request
                );
            }
        }
    }

    protected override async resolveTelemetryMetadata(
        args: ToolArgs<ReturnType<typeof this.argsShape>>,
        context: { result: CallToolResult }
    ): Promise<UpgradeClusterMetadata> {
        const parentMetadata = await super.resolveTelemetryMetadata(args, context);
        type UpgradeClusterOutput = z.infer<z.ZodObject<typeof UpgradeClusterOutputSchema>>;
        const sc = context.result.structuredContent as UpgradeClusterOutput | undefined;

        return {
            ...parentMetadata,
            original_tier: UpgradeClusterTool.toLowerCase(sc?.originalTier),
            target_tier: UpgradeClusterTool.toLowerCase(sc?.targetTier),
            database_edition: sc?.databaseEdition,
            compute_auto_scaling:
                sc?.computeAutoScaling === undefined ? undefined : sc.computeAutoScaling ? "true" : "false",
            min_instance_size: UpgradeClusterTool.toLowerCase(sc?.minInstanceSize),
            max_instance_size: UpgradeClusterTool.toLowerCase(sc?.maxInstanceSize),
            cluster_id: sc?.clusterId,
            provider: sc?.resolvedProvider,
            region: sc?.resolvedRegion,
        };
    }

    private static toLowerCase<T extends string>(value?: T): Lowercase<T> | undefined {
        if (typeof value === "undefined") {
            return undefined;
        }

        return value.toLowerCase() as Lowercase<T>;
    }
}
