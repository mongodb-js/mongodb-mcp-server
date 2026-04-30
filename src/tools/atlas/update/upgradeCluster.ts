import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { type OperationType, type ToolArgs } from "../../tool.js";
import { AtlasToolBase } from "../atlasTool.js";
import { formatCluster } from "../../../common/atlas/cluster.js";
import type { ApiClient } from "../../../common/atlas/apiClient.js";
import { AtlasArgs } from "../../args.js";

type ClusterResult =
    | { kind: "regular"; raw: Awaited<ReturnType<ApiClient["getCluster"]>> }
    | { kind: "flex"; raw: Awaited<ReturnType<ApiClient["getFlexCluster"]>> };

const ALLOWED_PROVIDER_REGEX = /^[A-Z_]+$/;

// Hardcoded defaults for all dedicated (M10) upgrade paths.
// provider and region are the only fields callers may override.
const DEDICATED_CLUSTER_DEFAULTS = {
    clusterType: "REPLICASET" as const,
    regionConfig: {
        priority: 7,
        electableSpecs: { instanceSize: "M10", nodeCount: 3 },
    },
    autoScaling: {
        compute: { enabled: true, scaleDownEnabled: true, minInstanceSize: "M10", maxInstanceSize: "M30" },
        diskGBEnabled: true,
    },
} as const;

type FreeToM10Body = {
    name: string;
    providerSettings: { providerName: string; instanceSizeName: "M10"; regionName?: string };
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

function buildM10UpgradeBody(baseTier: "FREE", clusterName: string, provider: string, region?: string): FreeToM10Body;
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
                providerName: provider ?? "",
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

export class UpgradeClusterTool extends AtlasToolBase {
    static toolName = "atlas-upgrade-cluster";
    public description =
        "Upgrade a MongoDB Atlas cluster tier. Upgrades Free (M0) clusters to Flex or M10 Dedicated, or Flex clusters to M10 Dedicated. The upgrade path is determined automatically from the current tier unless overridden with targetTier.";
    static operationType: OperationType = "update";
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
            .describe("Cloud provider region. If omitted, the existing value is preserved."),
    };

    protected async execute(args: ToolArgs<typeof this.argsShape>): Promise<CallToolResult> {
        const projectId = args.projectId ?? this.session.connectedAtlasCluster?.projectId;
        const clusterName = args.clusterName ?? this.session.connectedAtlasCluster?.clusterName;

        if (!projectId || !clusterName) {
            return {
                content: [
                    {
                        type: "text",
                        text: "projectId and clusterName are required when not connected to a cluster.",
                    },
                ],
                isError: true,
            };
        }

        const sessionCluster = this.session.connectedAtlasCluster;
        const knownInstanceType =
            sessionCluster?.projectId === projectId && sessionCluster?.clusterName === clusterName
                ? sessionCluster.instanceType
                : undefined;

        // Connected: instanceType is already known — skip all API fetches.
        // provider/region come from args only (no fetched defaults).
        if (knownInstanceType !== undefined) {
            if (knownInstanceType === "DEDICATED") {
                return {
                    content: [
                        {
                            type: "text",
                            text: `Cluster "${clusterName}" is already at the Dedicated tier and cannot be upgraded further.`,
                        },
                    ],
                    isError: true,
                };
            }
            const target = args.targetTier ?? (knownInstanceType === "FREE" ? "FLEX" : "M10");
            if (knownInstanceType === "FLEX" && target === "FLEX") {
                return {
                    content: [{ type: "text", text: `Cluster "${clusterName}" is already a Flex cluster.` }],
                    isError: true,
                };
            }
            if (knownInstanceType === "FREE") {
                return this.upgradeFreeCluster(
                    projectId,
                    clusterName,
                    target,
                    args.provider ?? sessionCluster?.provider ?? "AWS",
                    args.region ?? sessionCluster?.region
                );
            }
            return this.upgradeFlexCluster(
                projectId,
                clusterName,
                args.provider ?? sessionCluster?.provider,
                args.region ?? sessionCluster?.region
            );
        }

        // Not connected: fetch to determine the tier, reusing the raw result for provider/region defaults.
        // Try the regular clusters API first (FREE/DEDICATED), fall back to the flex API.
        let clusterResult: ClusterResult;
        try {
            clusterResult = {
                kind: "regular",
                raw: await this.apiClient.getCluster({
                    params: { path: { groupId: projectId, clusterName } },
                }),
            };
        } catch {
            clusterResult = {
                kind: "flex",
                raw: await this.apiClient.getFlexCluster({
                    params: { path: { groupId: projectId, name: clusterName } },
                }),
            };
        }

        if (clusterResult.kind === "regular") {
            const cluster = formatCluster(clusterResult.raw);
            if (cluster.instanceType === "DEDICATED") {
                return {
                    content: [
                        {
                            type: "text",
                            text: `Cluster "${clusterName}" is already at the Dedicated tier and cannot be upgraded further.`,
                        },
                    ],
                    isError: true,
                };
            }
            const target = args.targetTier ?? "FLEX";
            const firstRegionConfig = clusterResult.raw.replicationSpecs?.[0]?.regionConfigs?.[0] as
                | { backingProviderName?: string; regionName?: string }
                | undefined;
            const backingProviderName = args.provider ?? firstRegionConfig?.backingProviderName ?? "AWS";
            const regionName = args.region ?? firstRegionConfig?.regionName;
            return this.upgradeFreeCluster(projectId, clusterName, target, backingProviderName, regionName);
        }

        // FLEX cluster
        if (args.targetTier === "FLEX") {
            return {
                content: [{ type: "text", text: `Cluster "${clusterName}" is already a Flex cluster.` }],
                isError: true,
            };
        }
        const provider = args.provider ?? clusterResult.raw.providerSettings?.backingProviderName;
        const region = args.region ?? clusterResult.raw.providerSettings?.regionName;
        return this.upgradeFlexCluster(projectId, clusterName, provider, region);
    }

    private async upgradeFreeCluster(
        projectId: string,
        clusterName: string,
        target: "FLEX" | "M10",
        backingProviderName: string,
        regionName: string | undefined
    ): Promise<CallToolResult> {
        if (target === "FLEX") {
            await this.apiClient.upgradeSharedTierCluster({
                groupId: projectId,
                body: {
                    name: clusterName,
                    providerSettings: {
                        providerName: "FLEX",
                        instanceSizeName: "FLEX",
                        backingProviderName,
                        ...(regionName !== undefined && { regionName }),
                    },
                },
            });
            return {
                content: [
                    {
                        type: "text",
                        text: `Cluster "${clusterName}" is being upgraded from Free to Flex tier. This may take a few minutes.`,
                    },
                ],
            };
        }

        await this.apiClient.upgradeSharedTierCluster({
            groupId: projectId,
            body: buildM10UpgradeBody("FREE", clusterName, backingProviderName, regionName),
        });
        return {
            content: [
                {
                    type: "text",
                    text: `Cluster "${clusterName}" is being upgraded from Free to M10 Dedicated tier. This may take a few minutes.`,
                },
            ],
        };
    }

    private async upgradeFlexCluster(
        projectId: string,
        clusterName: string,
        provider: string | undefined,
        region: string | undefined
    ): Promise<CallToolResult> {
        await this.apiClient.upgradeFlexToDedicated({
            groupId: projectId,
            body: buildM10UpgradeBody("FLEX", clusterName, provider, region),
        });
        return {
            content: [
                {
                    type: "text",
                    text: `Cluster "${clusterName}" is being upgraded from Flex to M10 Dedicated tier. This may take a few minutes.`,
                },
            ],
        };
    }
}
