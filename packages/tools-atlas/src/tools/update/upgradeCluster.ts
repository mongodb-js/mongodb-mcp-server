import { z } from "zod";
import { type OperationType, type ToolArgs, type ToolResult, type ToolExecutionContext } from "../../tool.js";
import { AtlasToolBase } from "../atlasTool.js";
import { formatCluster } from "../../../common/atlas/cluster.js";
import type { ApiClient } from "../../../common/atlas/apiClient.js";
import { ApiClientError } from "../../../common/atlas/apiClientError.js";
import type { ClusterDescription20240805 } from "../../../common/atlas/openapi.js";
import { AtlasArgs } from "../../args.js";
import {
    standardInstanceSizeEnum,
    getMaxAutoScalingSize,
    type StandardInstanceSize,
} from "../../../common/atlas/cluster.js";
import type { UpgradeClusterMetadata } from "../../../telemetry/types.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

const ALLOWED_PROVIDER_REGEX = /^[A-Z_]+$/;

// Adds M140/M200 since getMaxAutoScalingSize can return those for M60/M80, and maxInstanceSize accepts them directly.
const INSTANCE_SIZE_ORDER = [...standardInstanceSizeEnum.options, "M140", "M200"];

function isHigherInstanceSize(a: string, b: string): boolean {
    return INSTANCE_SIZE_ORDER.indexOf(a) > INSTANCE_SIZE_ORDER.indexOf(b);
}

// maxInstanceSize can go beyond standardInstanceSizeEnum since autoscaling may grow an M60/M80 cluster past M80.
const maxAutoScalingSizeEnum = z.enum([...standardInstanceSizeEnum.options, "M140", "M200"]);

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

type FreeToM10Body = {
    name: string;
    providerSettings: {
        providerName?: string;
        instanceSizeName: "M10";
        regionName?: string;
        autoScaling?: { compute?: { minInstanceSize?: string; maxInstanceSize?: string } };
    };
    autoScaling: {
        compute: { enabled: boolean; scaleDownEnabled: boolean };
        diskGBEnabled: boolean;
    };
};

type FlexToM10Body = {
    name: string;
    clusterType: "REPLICASET";
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

function buildM10UpgradeBody(
    baseTier: "FREE",
    clusterName: string,
    autoScaling: ResolvedM10AutoScaling,
    provider?: string,
    region?: string
): FreeToM10Body;
function buildM10UpgradeBody(
    baseTier: "FLEX",
    clusterName: string,
    autoScaling: ResolvedM10AutoScaling,
    provider?: string,
    region?: string
): FlexToM10Body;
function buildM10UpgradeBody(
    baseTier: "FREE" | "FLEX",
    clusterName: string,
    autoScaling: ResolvedM10AutoScaling,
    provider?: string,
    region?: string
): FreeToM10Body | FlexToM10Body {
    const { enabled, minInstanceSize, maxInstanceSize } = autoScaling;

    if (baseTier === "FREE") {
        return {
            name: clusterName,
            providerSettings: {
                ...(provider !== undefined && { providerName: provider }),
                instanceSizeName: DEDICATED_CLUSTER_DEFAULTS.regionConfig.electableSpecs.instanceSize,
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
        replicationSpecs: [
            {
                regionConfigs: [
                    {
                        ...(provider !== undefined && { providerName: provider }),
                        ...(region !== undefined && { regionName: region }),
                        ...DEDICATED_CLUSTER_DEFAULTS.regionConfig,
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

type ResolvedClusterInfo = {
    instanceType: "FREE" | "FLEX" | "DEDICATED";
    provider?: string;
    region?: string;
    raw?: ClusterDescription20240805;
    instanceSize?: string;
};

async function resolveClusterInfo(
    apiClient: Pick<ApiClient, "getCluster" | "getFlexCluster">,
    projectId: string,
    clusterName: string,
    argOverrides: { provider?: string; region?: string },
    context: ToolExecutionContext
): Promise<ResolvedClusterInfo> {
    try {
        const raw = await apiClient.getCluster({ params: { path: { groupId: projectId, clusterName } } }, context);
        const cluster = formatCluster(raw);
        return {
            instanceType: cluster.instanceType,
            provider: argOverrides.provider ?? cluster.provider,
            region: argOverrides.region ?? cluster.region,
            raw,
            instanceSize: cluster.instanceSize,
        };
    } catch (err) {
        // Atlas returns 400 for Flex clusters on the regular cluster endpoint ("cannot be used in the Cluster API")
        // and 404 when the cluster simply doesn't exist. Both signal "try the flex endpoint instead".
        if (!(err instanceof ApiClientError) || (err.response.status !== 404 && err.response.status !== 400)) {
            throw err;
        }
        const raw = await apiClient.getFlexCluster(
            { params: { path: { groupId: projectId, name: clusterName } } },
            context
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

function buildScaleClusterBody(
    raw: ClusterDescription20240805 | undefined,
    targetSize: string,
    compute: ComputeAutoScaling
): ScaleClusterBody {
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

class UpgradeClusterError extends Error {}

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
function validateDedicatedScaling(
    clusterInfo: ResolvedClusterInfo,
    args: DedicatedScalingArgs,
    clusterName: string
): CurrentAutoScaling | undefined {
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

// Validates and resolves the upgrade target for a Free/Flex source cluster: defaults to FLEX for Free,
// M10 for Flex, and rejects any targetTier value that isn't a valid choice for a non-Dedicated source.
function resolveNonDedicatedTarget(args: { targetTier?: string }, instanceType: "FREE" | "FLEX"): "FLEX" | "M10" {
    if (args.targetTier !== undefined && args.targetTier !== "FLEX" && args.targetTier !== "M10") {
        throw new UpgradeClusterError(
            `targetTier "${args.targetTier}" is not valid when upgrading from ${instanceType}. Choose FLEX or M10 - larger instance sizes are only valid once the cluster is already Dedicated.`
        );
    }
    return args.targetTier ?? (instanceType === "FREE" ? "FLEX" : "M10");
}

export const UpgradeClusterOutputSchema = {
    originalTier: z.enum(["FREE", "FLEX", ...standardInstanceSizeEnum.options]),
    targetTier: z.enum(["FLEX", ...standardInstanceSizeEnum.options]),
    computeAutoScaling: z.boolean().optional(),
    minInstanceSize: z.string().optional(),
    maxInstanceSize: z.string().optional(),
    resolvedProvider: z.string().optional(),
    resolvedRegion: z.string().optional(),
    clusterId: z.string().optional(),
};

export class UpgradeClusterTool extends AtlasToolBase {
    static toolName = "atlas-upgrade-cluster";
    public description =
        "Upgrade or scale a MongoDB Atlas cluster. Free and Flex clusters can be upgraded to Flex or M10 Dedicated. Dedicated clusters can be scaled to a different instance size, and compute autoscaling settings can be updated. " +
        "When scaling a Dedicated cluster, at least one of targetTier, computeAutoScaling, minInstanceSize, or maxInstanceSize must be provided. " +
        "Compute autoscaling defaults to enabled when upgrading to M10 Dedicated: min instance size is set to the selected instance size, max is set two tiers above, unless overridden. " +
        "Note to LLM: If provider and region are not already known, ask for both together in a single question before calling this tool. " +
        "Use atlas-get-regions to resolve natural-language locations or uncertain region codes before calling this tool.";
    static operationType: OperationType = "update";
    public override outputSchema = UpgradeClusterOutputSchema;
    public argsShape = {
        projectId: AtlasArgs.projectId().describe("Atlas project ID"),
        clusterName: AtlasArgs.clusterName().describe("Name of the cluster to upgrade"),
        targetTier: z
            .enum(["FLEX", ...standardInstanceSizeEnum.options])
            .optional()
            .describe(
                "For a Free/Flex source cluster: the target tier to upgrade to, defaults to FLEX for Free clusters, M10 for Flex clusters. " +
                    "For a Dedicated cluster: the new instance size (M10-M80) to scale it to."
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

    protected async execute(
        args: ToolArgs<typeof this.argsShape>,
        context: ToolExecutionContext
    ): Promise<ToolResult<typeof this.outputSchema>> {
        const { projectId, clusterName } = args;

        const clusterInfo = await resolveClusterInfo(
            this.apiClient,
            projectId,
            clusterName,
            { provider: args.provider, region: args.region },
            context
        );

        let clusterId: string | undefined;
        let targetInstanceSize: string | undefined;
        let computeAutoScaling: boolean | undefined;
        let minInstanceSize: string | undefined;
        let maxInstanceSize: string | undefined;
        let isScaling = false;
        let target: "FLEX" | "M10" | undefined;

        switch (clusterInfo.instanceType) {
            case "DEDICATED": {
                const currentAutoScaling = validateDedicatedScaling(clusterInfo, args, clusterName);

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

                // Autoscaling max bound.
                let resolvedMax: string | undefined;
                if (args.maxInstanceSize !== undefined) {
                    // Explicit override always wins.
                    resolvedMax = args.maxInstanceSize;
                } else if (!resolvedEnabled) {
                    // Autoscaling disabled: no max needed.
                    resolvedMax = undefined;
                } else if (isScaling) {
                    // Resizing without an explicit max: default to two tiers above the new size, unless the
                    // cluster's existing max was already higher.
                    const defaultMax = getMaxAutoScalingSize(resolvedInstanceSize, clusterInfo.provider ?? "");
                    const existingMax = currentAutoScaling?.maxInstanceSize;
                    resolvedMax =
                        existingMax !== undefined && isHigherInstanceSize(existingMax, defaultMax)
                            ? existingMax
                            : defaultMax;
                } else {
                    // Not resizing: keep the cluster's current max, falling back to the default if autoscaling wasn't already configured.
                    resolvedMax =
                        currentAutoScaling?.maxInstanceSize ??
                        getMaxAutoScalingSize(resolvedInstanceSize, clusterInfo.provider ?? "");
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

                const body = buildScaleClusterBody(clusterInfo.raw, resolvedInstanceSize, {
                    enabled: resolvedEnabled,
                    scaleDownEnabled: resolvedEnabled,
                    minInstanceSize: resolvedMin,
                    maxInstanceSize: resolvedMax,
                });

                const result = await this.apiClient.updateCluster(
                    {
                        params: { path: { groupId: projectId, clusterName } },
                        body: body as unknown as ClusterDescription20240805,
                    },
                    context
                );
                clusterId = result.id;
                targetInstanceSize = resolvedInstanceSize;
                computeAutoScaling = resolvedEnabled;
                minInstanceSize = resolvedMin;
                maxInstanceSize = resolvedMax;
                break;
            }
            case "FLEX": {
                target = resolveNonDedicatedTarget(args, "FLEX");
                if (target === "FLEX") {
                    throw new UpgradeClusterError(`Cluster "${clusterName}" is already a Flex cluster.`);
                }

                const resolvedAutoScaling = resolveM10AutoScaling(args, clusterInfo.provider);

                // tenantUpgrade: upgrades Flex clusters to Dedicated (M10+)
                ({ id: clusterId } = await this.apiClient.tenantUpgrade(
                    {
                        params: { path: { groupId: projectId } },
                        body: buildM10UpgradeBody(
                            "FLEX",
                            clusterName,
                            resolvedAutoScaling,
                            clusterInfo.provider,
                            clusterInfo.region
                        ),
                    } as unknown as Parameters<typeof this.apiClient.tenantUpgrade>[0],
                    context
                ));
                break;
            }
            case "FREE":
                target = resolveNonDedicatedTarget(args, "FREE");
                if (
                    target === "FLEX" &&
                    (args.computeAutoScaling !== undefined ||
                        args.minInstanceSize !== undefined ||
                        args.maxInstanceSize !== undefined)
                ) {
                    throw new UpgradeClusterError(
                        `Invalid Arguments:computeAutoScaling/minInstanceSize/maxInstanceSize. Flex clusters do not support compute autoscaling.`
                    );
                }

                ({ id: clusterId } = await this.upgradeFreeCluster(
                    projectId,
                    clusterName,
                    target,
                    clusterInfo.provider,
                    clusterInfo.region,
                    args,
                    context
                ));
                break;
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

        return {
            content: [
                {
                    type: "text",
                    text: isAutoscaling
                        ? `Cluster "${clusterName}" is being upgraded from ${clusterInfo.instanceType} to ${target} tier with compute autoscaling ${computeAutoScaling ? `enabled (${minInstanceSize}-${maxInstanceSize})` : "disabled"}. This may take a few minutes.`
                        : `Cluster "${clusterName}" is being upgraded from ${clusterInfo.instanceType} to ${target} tier. This may take a few minutes.`,
                },
            ],
            structuredContent: {
                originalTier: clusterInfo.instanceType,
                targetTier: target as "FLEX" | "M10",
                resolvedProvider: clusterInfo.provider,
                resolvedRegion: clusterInfo.region,
                clusterId,
            },
        };
    }

    protected override handleError(error: unknown, args: ToolArgs<typeof this.argsShape>): CallToolResult {
        if (error instanceof UpgradeClusterError) {
            return {
                content: [{ type: "text", text: error.message }],
                isError: true,
            };
        }

        return super.handleError(error, args) as CallToolResult;
    }

    private async upgradeFreeCluster(
        projectId: string,
        clusterName: string,
        target: "FLEX" | "M10",
        backingProviderName: string | undefined,
        regionName: string | undefined,
        autoScalingArgs: AutoScalingArgs,
        context: ToolExecutionContext
    ): Promise<{ id?: string }> {
        // upgradeTenantUpgrade: upgrades Free (M0/shared) clusters to Flex or Dedicated (M10+)
        switch (target) {
            case "FLEX":
                return await this.apiClient.upgradeTenantUpgrade(
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
                    } as unknown as Parameters<typeof this.apiClient.upgradeTenantUpgrade>[0],
                    context
                );
            case "M10":
                return await this.apiClient.upgradeTenantUpgrade(
                    {
                        params: { path: { groupId: projectId } },
                        body: buildM10UpgradeBody(
                            "FREE",
                            clusterName,
                            resolveM10AutoScaling(autoScalingArgs, backingProviderName),
                            backingProviderName,
                            regionName
                        ),
                    } as unknown as Parameters<typeof this.apiClient.upgradeTenantUpgrade>[0],
                    context
                );
        }
    }

    protected override async resolveTelemetryMetadata(
        args: ToolArgs<typeof this.argsShape>,
        context: { result: CallToolResult }
    ): Promise<UpgradeClusterMetadata> {
        const parentMetadata = await super.resolveTelemetryMetadata(args, context);
        type UpgradeClusterOutput = z.infer<z.ZodObject<typeof UpgradeClusterOutputSchema>>;
        const sc = context.result.structuredContent as UpgradeClusterOutput | undefined;

        return {
            ...parentMetadata,
            original_tier: UpgradeClusterTool.toLowerCase(sc?.originalTier),
            target_tier: UpgradeClusterTool.toLowerCase(sc?.targetTier),
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
