import { z } from "zod";
import { type OperationType, type ToolArgs, type ToolResult } from "../../tool.js";
import { AtlasToolBase } from "../atlasTool.js";
import { formatCluster } from "../../../common/atlas/cluster.js";
import type { ApiClient } from "../../../common/atlas/apiClient.js";
import { ApiClientError } from "../../../common/atlas/apiClientError.js";
import { AtlasArgs } from "../../args.js";
import type { UpgradeClusterMetadata } from "../../../telemetry/types.js";
import type { AtlasClusterConnectionInfo } from "../../../common/connectionInfo.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

const ALLOWED_PROVIDER_REGEX = /^[A-Z_]+$/;

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
    autoScaling: {
        compute: { enabled: true, scaleDownEnabled: true, minInstanceSize: "M10", maxInstanceSize: "M30" },
        diskGBEnabled: true,
    },
} as const;

type FreeToM10Body = {
    name: string;
    providerSettings: { providerName?: string; instanceSizeName: "M10"; regionName?: string };
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
        }>;
    }>;
    autoScaling: typeof DEDICATED_CLUSTER_DEFAULTS.autoScaling;
};

function buildM10UpgradeBody(baseTier: "FREE", clusterName: string, provider?: string, region?: string): FreeToM10Body;
function buildM10UpgradeBody(baseTier: "FLEX", clusterName: string, provider?: string, region?: string): FlexToM10Body;
function buildM10UpgradeBody(
    baseTier: "FREE" | "FLEX",
    clusterName: string,
    provider?: string,
    region?: string
): FreeToM10Body | FlexToM10Body {
    if (baseTier === "FREE") {
        return {
            name: clusterName,
            providerSettings: {
                ...(provider !== undefined && { providerName: provider }),
                instanceSizeName: DEDICATED_CLUSTER_DEFAULTS.regionConfig.electableSpecs.instanceSize,
                ...(region !== undefined && { regionName: region }),
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
                    },
                ],
            },
        ],
        autoScaling: DEDICATED_CLUSTER_DEFAULTS.autoScaling,
    };
}

type ResolvedClusterInfo = {
    instanceType: "FREE" | "FLEX" | "DEDICATED";
    provider?: string;
    region?: string;
};

async function resolveClusterInfo(
    apiClient: Pick<ApiClient, "getCluster" | "getFlexCluster">,
    projectId: string,
    clusterName: string,
    argOverrides: { provider?: string; region?: string },
    sessionCluster: AtlasClusterConnectionInfo | undefined
): Promise<ResolvedClusterInfo> {
    const knownInstanceType =
        sessionCluster?.projectId === projectId && sessionCluster?.clusterName === clusterName
            ? sessionCluster.instanceType
            : undefined;

    if (knownInstanceType !== undefined) {
        return {
            instanceType: knownInstanceType,
            provider: argOverrides.provider ?? sessionCluster?.provider,
            region: argOverrides.region ?? sessionCluster?.region,
        };
    }

    try {
        const raw = await apiClient.getCluster({ params: { path: { groupId: projectId, clusterName } } });
        const cluster = formatCluster(raw);
        const firstRegionConfig = raw.replicationSpecs?.[0]?.regionConfigs?.[0] as
            | { backingProviderName?: string; regionName?: string }
            | undefined;
        return {
            instanceType: cluster.instanceType,
            provider: argOverrides.provider ?? firstRegionConfig?.backingProviderName,
            region: argOverrides.region ?? firstRegionConfig?.regionName,
        };
    } catch (err) {
        // Atlas returns 400 for Flex clusters on the regular cluster endpoint ("cannot be used in the Cluster API")
        // and 404 when the cluster simply doesn't exist. Both signal "try the flex endpoint instead".
        if (!(err instanceof ApiClientError) || (err.response.status !== 404 && err.response.status !== 400)) {
            throw err;
        }
        const raw = await apiClient.getFlexCluster({ params: { path: { groupId: projectId, name: clusterName } } });
        return {
            instanceType: "FLEX",
            provider: argOverrides.provider ?? raw.providerSettings?.backingProviderName,
            region: argOverrides.region ?? raw.providerSettings?.regionName,
        };
    }
}

class UpgradeClusterError extends Error {}

export const UpgradeClusterOutputSchema = {
    originalTier: z.enum(["FREE", "FLEX"]),
    targetTier: z.enum(["FLEX", "M10"]),
    resolvedProvider: z.string().optional(),
    resolvedRegion: z.string().optional(),
};

export class UpgradeClusterTool extends AtlasToolBase {
    static toolName = "atlas-upgrade-cluster";
    public description =
        "Upgrade a MongoDB Atlas cluster tier. Upgrades Free (M0) clusters to Flex or M10 Dedicated, or Flex clusters to M10 Dedicated. The upgrade path is determined automatically from the current tier unless overridden with targetTier.";
    static operationType: OperationType = "update";
    public override outputSchema = UpgradeClusterOutputSchema;
    public argsShape = {
        projectId: AtlasArgs.projectId()
            .optional()
            .describe("Atlas project ID. Required if not connected to a cluster."),
        clusterName: AtlasArgs.clusterName()
            .optional()
            .describe("Name of the cluster to upgrade. Required if not connected to a cluster."),
        targetTier: z
            .enum(["FLEX", "M10"])
            .optional()
            .describe("Target tier to upgrade to. Defaults to FLEX for Free clusters and M10 for Flex clusters."),
        provider: z
            .string()
            .regex(ALLOWED_PROVIDER_REGEX, "Provider must be uppercase letters and underscores only")
            .optional()
            .describe("Cloud provider (e.g. AWS, GCP, AZURE). If omitted, the existing value is preserved."),
        region: AtlasArgs.region()
            .optional()
            .describe(
                "Cloud provider region in Atlas format using uppercase letters and underscores (e.g. US_EAST_1). If omitted, the existing value is preserved."
            ),
    };

    protected async execute(args: ToolArgs<typeof this.argsShape>): Promise<ToolResult<typeof this.outputSchema>> {
        const projectId = args.projectId ?? this.session.connectedAtlasCluster?.projectId;
        const clusterName = args.clusterName ?? this.session.connectedAtlasCluster?.clusterName;

        if (!projectId || !clusterName) {
            throw new UpgradeClusterError("projectId and clusterName are required when not connected to a cluster.");
        }

        const clusterInfo = await resolveClusterInfo(
            this.apiClient,
            projectId,
            clusterName,
            { provider: args.provider, region: args.region },
            this.session.connectedAtlasCluster
        );

        const target = args.targetTier ?? (clusterInfo.instanceType === "FREE" ? "FLEX" : "M10");
        switch (clusterInfo.instanceType) {
            case "DEDICATED":
                throw new UpgradeClusterError(
                    `Cluster "${clusterName}" is already at the Dedicated tier and cannot be upgraded further.`
                );
            case "FLEX":
                if (target === "FLEX") {
                    throw new UpgradeClusterError(`Cluster "${clusterName}" is already a Flex cluster.`);
                }

                await this.apiClient.upgradeFlexToDedicated({
                    groupId: projectId,
                    body: buildM10UpgradeBody("FLEX", clusterName, clusterInfo.provider, clusterInfo.region),
                });
                break;
            case "FREE":
                await this.upgradeFreeCluster(projectId, clusterName, target, clusterInfo.provider, clusterInfo.region);
                break;
        }

        return {
            content: [
                {
                    type: "text",
                    text: `Cluster "${clusterName}" is being upgraded from ${clusterInfo.instanceType} to ${target} tier. This may take a few minutes.`,
                },
            ],
            structuredContent: {
                originalTier: clusterInfo.instanceType,
                targetTier: target,
                resolvedProvider: clusterInfo.provider,
                resolvedRegion: clusterInfo.region,
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
        regionName: string | undefined
    ): Promise<void> {
        switch (target) {
            case "FLEX":
                await this.apiClient.upgradeSharedTierCluster({
                    groupId: projectId,
                    body: {
                        name: clusterName,
                        providerSettings: {
                            providerName: "FLEX",
                            instanceSizeName: "FLEX",
                            ...(backingProviderName !== undefined && { backingProviderName }),
                            ...(regionName !== undefined && { regionName }),
                        },
                    },
                });
                break;
            case "M10":
                await this.apiClient.upgradeSharedTierCluster({
                    groupId: projectId,
                    body: buildM10UpgradeBody("FREE", clusterName, backingProviderName, regionName),
                });
                break;
        }
    }

    protected override resolveTelemetryMetadata(
        args: ToolArgs<typeof this.argsShape>,
        context: { result: CallToolResult }
    ): UpgradeClusterMetadata {
        const parentMetadata = super.resolveTelemetryMetadata(args, context);
        type UpgradeClusterOutput = z.infer<z.ZodObject<typeof UpgradeClusterOutputSchema>>;
        const sc = context.result.structuredContent as UpgradeClusterOutput | undefined;

        return {
            ...parentMetadata,
            original_tier: UpgradeClusterTool.toLowerCase(sc?.originalTier),
            target_tier: UpgradeClusterTool.toLowerCase(sc?.targetTier),
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
