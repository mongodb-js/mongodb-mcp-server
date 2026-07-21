import { z } from "zod";
import { type OperationType, type ToolArgs, type ToolResult, type ToolExecutionContext } from "../../tool.js";
import { AtlasToolBase } from "../atlasTool.js";
import { formatCluster } from "../../../common/atlas/cluster.js";
import type { ApiClient } from "../../../common/atlas/apiClient.js";
import { ApiClientError } from "../../../common/atlas/apiClientError.js";
import { AtlasArgs } from "../../args.js";
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
    context: ToolExecutionContext
): Promise<ResolvedClusterInfo> {
    try {
        const raw = await apiClient.getCluster({ params: { path: { groupId: projectId, clusterName } } }, context);
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

class UpgradeClusterError extends Error {}

export const UpgradeClusterOutputSchema = {
    originalTier: z.enum(["FREE", "FLEX"]),
    targetTier: z.enum(["FLEX", "M10"]),
    resolvedProvider: z.string().optional(),
    resolvedRegion: z.string().optional(),
    clusterId: z.string().optional(),
};

export class UpgradeClusterTool extends AtlasToolBase {
    static toolName = "atlas-upgrade-cluster";
    public description =
        "Upgrade a MongoDB Atlas cluster tier. Upgrades Free (M0) clusters to Flex or M10 Dedicated, or Flex clusters to M10 Dedicated. " +
        "The upgrade path is determined automatically from the current tier unless overridden with targetTier. " +
        "This tool is ONLY for Free and Flex clusters: to change the instance size or autoscaling of a cluster that is already Dedicated (M10+), use the atlas-scale-cluster tool instead. " +
        "Note to LLM: If provider and region are not already known, ask for both together in a single question before calling this tool. " +
        REGION_RECOMMENDATIONS;
    static operationType: OperationType = "update";
    public override outputSchema = UpgradeClusterOutputSchema;
    public argsShape = {
        projectId: AtlasArgs.projectId().describe("Atlas project ID"),
        clusterName: AtlasArgs.clusterName().describe("Name of the cluster to upgrade"),
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

        const target = args.targetTier ?? (clusterInfo.instanceType === "FREE" ? "FLEX" : "M10");
        let clusterId: string | undefined;
        switch (clusterInfo.instanceType) {
            case "DEDICATED":
                throw new UpgradeClusterError(
                    `Cluster "${clusterName}" is already at the Dedicated tier and cannot be upgraded further.`
                );
            case "FLEX":
                if (target === "FLEX") {
                    throw new UpgradeClusterError(`Cluster "${clusterName}" is already a Flex cluster.`);
                }

                // tenantUpgrade: upgrades Flex clusters to Dedicated (M10+)
                ({ id: clusterId } = await this.apiClient.tenantUpgrade(
                    {
                        params: { path: { groupId: projectId } },
                        body: buildM10UpgradeBody("FLEX", clusterName, clusterInfo.provider, clusterInfo.region),
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
                    context
                ));
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
                        body: buildM10UpgradeBody("FREE", clusterName, backingProviderName, regionName),
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
