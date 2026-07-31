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
    isStandardInstanceSize,
    type StandardInstanceSize,
} from "../../../common/atlas/cluster.js";
import type { UpgradeClusterMetadata } from "../../../telemetry/types.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

const ALLOWED_PROVIDER_REGEX = /^[A-Z_]+$/;

const REGION_RECOMMENDATIONS = `Common region mappings by provider (default recommendation: AWS US_EAST_1):
AWS: "East Coast"/"Virginia"/"US East" → US_EAST_1, "Ohio" → US_EAST_2, "California"/"West Coast" → US_WEST_2, "Southeast Asia"/"APAC"/"Singapore" → AP_SOUTHEAST_1, "Europe"/"EU"/"Ireland" → EU_WEST_1.
GCP: "Central US" → CENTRAL_US, "Western US" → WESTERN_US, "Southeast Asia"/"APAC" → SOUTHEASTERN_ASIA_PACIFIC, "Europe"/"EU" → WESTERN_EUROPE.
AZURE: "East US" → US_EAST_2, "West US" → US_WEST_2, "Europe"/"EU" → EUROPE_NORTH.`;

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

function buildM10UpgradeBody(
    baseTier: "FREE",
    clusterName: string,
    autoScalingArgs: AutoScalingArgs,
    provider?: string,
    region?: string
): FreeToM10Body;
function buildM10UpgradeBody(
    baseTier: "FLEX",
    clusterName: string,
    autoScalingArgs: AutoScalingArgs,
    provider?: string,
    region?: string
): FlexToM10Body;
function buildM10UpgradeBody(
    baseTier: "FREE" | "FLEX",
    clusterName: string,
    autoScalingArgs: AutoScalingArgs,
    provider?: string,
    region?: string
): FreeToM10Body | FlexToM10Body {
    if (autoScalingArgs.minInstanceSize !== undefined && autoScalingArgs.minInstanceSize !== "M10") {
        throw new UpgradeClusterError(`minInstanceSize must be omitted or "M10" when upgrading to M10 Dedicated.`);
    }

    const enabled = autoScalingArgs.computeAutoScaling ?? true;
    const minInstanceSize = enabled ? (autoScalingArgs.minInstanceSize ?? "M10") : autoScalingArgs.minInstanceSize;
    const maxInstanceSize = enabled
        ? (autoScalingArgs.maxInstanceSize ?? getDefaultMaxAutoScalingSize("M10"))
        : autoScalingArgs.maxInstanceSize;

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
    autoScaling?: { compute?: { enabled?: boolean; minInstanceSize?: string; maxInstanceSize?: string } };
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
        const firstRegionConfig = raw.replicationSpecs?.[0]?.regionConfigs?.[0] as
            | {
                  autoScaling?: { compute?: { enabled?: boolean; minInstanceSize?: string; maxInstanceSize?: string } };
              }
            | undefined;
        return {
            instanceType: cluster.instanceType,
            provider: argOverrides.provider ?? cluster.provider,
            region: argOverrides.region ?? cluster.region,
            raw,
            instanceSize: cluster.instanceSize,
            autoScaling: { compute: firstRegionConfig?.autoScaling?.compute },
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

// Default max autoscaling size when none is given: two tiers above `size`, capped at M80.
function getDefaultMaxAutoScalingSize(size: StandardInstanceSize): StandardInstanceSize {
    const index = standardInstanceSizeEnum.options.indexOf(size);
    return standardInstanceSizeEnum.options[Math.min(index + 2, standardInstanceSizeEnum.options.length - 1)] ?? "M80";
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
    autoScaling?: { compute: ComputeAutoScaling; diskGB?: unknown };
} & Record<string, unknown>;

type ScaleClusterBody = {
    replicationSpecs: Array<{ regionConfigs: ScaleRegionConfig[] } & Record<string, unknown>>;
};

function buildRegionAutoScaling(
    compute: ComputeAutoScaling,
    existingAutoScaling: { diskGB?: unknown } | undefined
): { compute: ComputeAutoScaling; diskGB?: unknown } {
    return {
        compute: { ...compute },
        ...(existingAutoScaling?.diskGB !== undefined && { diskGB: existingAutoScaling.diskGB }),
    };
}

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
            return {
                ...rc,
                ...(electableSpecs && { electableSpecs: { ...electableSpecs, instanceSize: targetSize } }),
                ...(readOnlySpecs && { readOnlySpecs: { ...readOnlySpecs, instanceSize: targetSize } }),
                autoScaling: buildRegionAutoScaling(compute, rc.autoScaling as { diskGB?: unknown } | undefined),
            };
        });
        return { ...spec, regionConfigs };
    }) as ScaleClusterBody["replicationSpecs"];

    return { replicationSpecs };
}

class UpgradeClusterError extends Error {}

export const UpgradeClusterOutputSchema = {
    originalTier: z.enum(["FREE", "FLEX", "DEDICATED"]),
    targetTier: z.enum(["FLEX", "DEDICATED"]),
    originalInstanceSize: z.string().optional(),
    targetInstanceSize: z.string().optional(),
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
        "Upgrade or scale a MongoDB Atlas cluster: upgrades Free/Flex clusters to Flex or M10 Dedicated, scales a dedicated cluster's instance size, or updates autoscaling. " +
        "Compute autoscaling defaults to enabled when upgrading to M10 Dedicated: min instance size is set to the selected instance size, max is set two tiers above, unless overridden. " +
        "Note to LLM: If provider and region are not already known, ask for both together in a single question before calling this tool. " +
        REGION_RECOMMENDATIONS;
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
                    "For an already-Dedicated cluster: the new instance size (M10-M80) to scale it to."
            ),
        computeAutoScaling: z
            .boolean()
            .optional()
            .describe(
                "When true, enables compute autoscaling for an already-Dedicated cluster being scaled, or for a Free/Flex cluster upgrading to M10 Dedicated (Flex itself has no autoscaling). Min instance size is set to the selected instance size, max is set two tiers above, unless overridden. Omit unless explicitly specified by the user."
            ),
        minInstanceSize: standardInstanceSizeEnum
            .optional()
            .describe(
                "Minimum instance size (M10-M80) for compute autoscaling, for Dedicated scaling or a Free/Flex-to-M10 upgrade."
            ),
        maxInstanceSize: standardInstanceSizeEnum
            .optional()
            .describe(
                "Maximum instance size (M10-M80) for compute autoscaling, for Dedicated scaling or a Free/Flex-to-M10 upgrade. Defaults to two tiers above the instance size, capped at M80."
            ),
        provider: z
            .string()
            .regex(ALLOWED_PROVIDER_REGEX, "Provider must be uppercase letters and underscores only")
            .optional()
            .describe(
                "Cloud provider (e.g. AWS, GCP, AZURE) for a Free/Flex source cluster. Preserves the existing value if omitted. Does not apply once a cluster is already Dedicated, since scaling never relocates a cluster."
            ),
        region: AtlasArgs.region()
            .optional()
            .describe(
                "Cloud provider region in Atlas format using uppercase letters and underscores (e.g. US_EAST_1) for a Free/Flex source cluster. Preserves the existing value if omitted. Does not apply once a cluster is already Dedicated."
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

        if (clusterInfo.instanceType === "DEDICATED") {
            if (args.targetTier === "FLEX") {
                throw new UpgradeClusterError(
                    `Cluster "${clusterName}" is already Dedicated. targetTier must be an instance size (M10-M80) to scale it in place, not FLEX.`
                );
            }
        } else if (args.targetTier !== undefined && args.targetTier !== "FLEX" && args.targetTier !== "M10") {
            throw new UpgradeClusterError(
                `targetTier "${args.targetTier}" is not valid when upgrading from ${clusterInfo.instanceType}. Choose FLEX or M10 - larger instance sizes are only valid once the cluster is already Dedicated.`
            );
        }

        const target =
            (args.targetTier as "FLEX" | "M10" | undefined) ?? (clusterInfo.instanceType === "FREE" ? "FLEX" : "M10");

        if (
            clusterInfo.instanceType !== "DEDICATED" &&
            target === "FLEX" &&
            (args.computeAutoScaling !== undefined ||
                args.minInstanceSize !== undefined ||
                args.maxInstanceSize !== undefined)
        ) {
            throw new UpgradeClusterError(
                `Invalid Arguments:computeAutoScaling/minInstanceSize/maxInstanceSize. Flex clusters do not support compute autoscaling.`
            );
        }

        let clusterId: string | undefined;
        let targetInstanceSize: string | undefined;
        let computeAutoScaling: boolean | undefined;
        let minInstanceSize: string | undefined;
        let maxInstanceSize: string | undefined;

        switch (clusterInfo.instanceType) {
            case "DEDICATED": {
                if (args.provider !== undefined || args.region !== undefined) {
                    throw new UpgradeClusterError(
                        `Invalid Arguments:provider/region. provider/region are not valid when scaling an already-Dedicated cluster "${clusterName}", scaling does not relocate a cluster.`
                    );
                }
                if (
                    args.targetTier === undefined &&
                    args.computeAutoScaling === undefined &&
                    args.minInstanceSize === undefined &&
                    args.maxInstanceSize === undefined
                ) {
                    throw new UpgradeClusterError(
                        `No changes specified for Dedicated cluster "${clusterName}". Provide targetTier (new instance size) and/or computeAutoScaling to scale it.`
                    );
                }
                if (clusterInfo.instanceSize === undefined || !isStandardInstanceSize(clusterInfo.instanceSize)) {
                    throw new UpgradeClusterError(
                        `Cluster "${clusterName}" has instance size "${clusterInfo.instanceSize ?? "unknown"}", which this tool does not support scaling. Only standard M10-M80 instance sizes are supported.`
                    );
                }
                if ((clusterInfo.raw?.replicationSpecs?.length ?? 0) > 1) {
                    throw new UpgradeClusterError(
                        `Cluster "${clusterName}" has multiple shards, which this tool does not support scaling. Only single-shard (replica set) clusters are supported.`
                    );
                }
                const regionElectableSizes = (clusterInfo.raw?.replicationSpecs?.[0]?.regionConfigs ?? [])
                    .map((rc) => (rc as { electableSpecs?: { instanceSize?: string } }).electableSpecs?.instanceSize)
                    .filter((size): size is string => size !== undefined);
                if (new Set(regionElectableSizes).size > 1) {
                    throw new UpgradeClusterError(
                        `Cluster "${clusterName}" has regions with different instance sizes, which this tool does not support scaling consistently.`
                    );
                }

                const newSize: StandardInstanceSize =
                    (args.targetTier as StandardInstanceSize | undefined) ?? clusterInfo.instanceSize;
                const newEnabled = args.computeAutoScaling ?? clusterInfo.autoScaling?.compute?.enabled ?? false;
                const isResizing = args.targetTier !== undefined;
                const newMin =
                    args.minInstanceSize ??
                    (isResizing ? undefined : clusterInfo.autoScaling?.compute?.minInstanceSize) ??
                    (newEnabled ? newSize : undefined);
                const newMax =
                    args.maxInstanceSize ??
                    (isResizing ? undefined : clusterInfo.autoScaling?.compute?.maxInstanceSize) ??
                    (newEnabled ? getDefaultMaxAutoScalingSize(newSize) : undefined);

                const body = buildScaleClusterBody(clusterInfo.raw, newSize, {
                    enabled: newEnabled,
                    scaleDownEnabled: newEnabled,
                    minInstanceSize: newMin,
                    maxInstanceSize: newMax,
                });

                const result = await this.apiClient.updateCluster(
                    {
                        params: { path: { groupId: projectId, clusterName } },
                        body: body as unknown as ClusterDescription20240805,
                    },
                    context
                );
                clusterId = result.id;
                targetInstanceSize = newSize;
                computeAutoScaling = newEnabled;
                minInstanceSize = newMin;
                maxInstanceSize = newMax;
                break;
            }
            case "FLEX":
                if (target === "FLEX") {
                    throw new UpgradeClusterError(`Cluster "${clusterName}" is already a Flex cluster.`);
                }

                // tenantUpgrade: upgrades Flex clusters to Dedicated (M10+)
                ({ id: clusterId } = await this.apiClient.tenantUpgrade(
                    {
                        params: { path: { groupId: projectId } },
                        body: buildM10UpgradeBody("FLEX", clusterName, args, clusterInfo.provider, clusterInfo.region),
                    } as unknown as Parameters<typeof this.apiClient.tenantUpgrade>[0],
                    context
                ));
                break;
            case "FREE":
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
            const isScaling = targetInstanceSize !== clusterInfo.instanceSize;
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
                    originalTier: "DEDICATED",
                    targetTier: "DEDICATED",
                    originalInstanceSize: clusterInfo.instanceSize,
                    targetInstanceSize,
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
                targetTier: target === "FLEX" ? "FLEX" : "DEDICATED",
                targetInstanceSize: target === "M10" ? "M10" : undefined,
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
                            autoScalingArgs,
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
            original_tier: UpgradeClusterTool.toLowerCase(sc?.originalInstanceSize ?? sc?.originalTier) as
                | UpgradeClusterMetadata["original_tier"]
                | undefined,
            target_tier: UpgradeClusterTool.toLowerCase(sc?.targetInstanceSize ?? sc?.targetTier) as
                | UpgradeClusterMetadata["target_tier"]
                | undefined,
            compute_auto_scaling:
                sc?.computeAutoScaling === undefined ? undefined : sc.computeAutoScaling ? "true" : "false",
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
