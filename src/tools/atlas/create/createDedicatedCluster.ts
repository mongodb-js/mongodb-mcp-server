import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { type ToolArgs, type OperationType } from "../../tool.js";
import { AtlasToolBase } from "../atlasTool.js";
import type { ClusterDescription20240805 } from "../../../common/atlas/openapi.js";
import { AtlasArgs } from "../../args.js";

function parseInstanceSizeNum(size: string): number {
    const match = size.match(/(\d+)/);
    return match ? parseInt(match[1], 10) : 0;
}

export class CreateDedicatedClusterTool extends AtlasToolBase {
    static toolName = "atlas-create-dedicated-cluster";
    static operationType: OperationType = "create";

    public description = `Creates a dedicated MongoDB Atlas cluster (M10 or larger). Supports replica sets and sharded clusters across single or multiple regions.

Use numShards: 2 or more for high-volume workloads requiring horizontal scaling (typically >10TB data or very high write throughput). For most production use cases, the default replica set (numShards: 1) provides high availability without the operational overhead of sharding. Sharded clusters require M30 or larger.

For multi-region deployments, pass at least 2 entries in additionalRegions (3 total regions) to meet the minimum ≥5 electable nodes across regions best practice.

Enable backupEnabled: true for any production cluster. Enable pitEnabled: true alongside backupEnabled for point-in-time recovery.

Does not set up network access or database users. After creation, use atlas-connect-cluster to connect (it handles access list and temporary credentials). To pause a cluster after creation, use atlas-pause-cluster (it waits for IDLE then issues the pause).`;

    public argsShape = {
        projectId: AtlasArgs.projectId().describe("Atlas project ID to create the cluster in"),
        name: AtlasArgs.clusterName().optional().describe("Name of the cluster"),
        provider: z
            .enum(["AWS", "GCP", "AZURE"])
            .default("AWS")
            .describe("Cloud provider: AWS, GCP, or AZURE"),
        region: AtlasArgs.region()
            .default("US_EAST_1")
            .describe("Cloud provider region name (e.g. US_EAST_1, EU_WEST_1)"),
        instanceSize: z
            .string()
            .default("M10")
            .describe("Instance size (M10–M80). Sharded clusters require M30 or larger"),
        numShards: z
            .number()
            .int()
            .min(1)
            .default(1)
            .describe("Number of shards. Use ≥2 for SHARDED clusters (requires M30+). Default: 1 (REPLICASET)"),
        additionalRegions: z
            .array(z.string())
            .default([])
            .describe(
                "Additional regions for multi-region deployment. Pass at least 2 for ≥5 total electable nodes best practice"
            ),
        autoScaling: z.boolean().default(true).describe("Enable compute and disk autoscaling"),
        autoScalingMaxInstanceSize: z
            .string()
            .default("M40")
            .describe("Maximum instance size when autoscaling is enabled"),
        mongoDBMajorVersion: z
            .string()
            .optional()
            .describe("MongoDB major version (e.g. '8.0'). Mutually exclusive with versionReleaseSystem"),
        versionReleaseSystem: z
            .enum(["LTS", "CONTINUOUS"])
            .optional()
            .describe("Version release system. Mutually exclusive with mongoDBMajorVersion"),
        backupEnabled: z
            .boolean()
            .default(true)
            .describe("Enable cloud backup (continuous snapshots). Defaults to true — set to false only for dev/test clusters where cost matters more than durability"),
        pitEnabled: z
            .boolean()
            .default(false)
            .describe("Enable point-in-time recovery. Requires backupEnabled: true"),
        terminationProtectionEnabled: z
            .boolean()
            .default(false)
            .describe("Prevent accidental cluster deletion"),
    };

    protected async execute(args: ToolArgs<typeof this.argsShape>): Promise<CallToolResult> {
        let {
            projectId,
            name,
            provider,
            region,
            instanceSize,
            numShards,
            additionalRegions,
            autoScaling,
            autoScalingMaxInstanceSize,
            mongoDBMajorVersion,
            versionReleaseSystem,
            backupEnabled,
            pitEnabled,
            terminationProtectionEnabled,
        } = args;

        // Phase 1: elicit name when missing
        if (!name) {
            if (this.elicitation.supportsElicitation()) {
                const result = await this.elicitation.requestInput(
                    "To create a dedicated cluster I need the cluster name.",
                    {
                        type: "object",
                        properties: {
                            name: {
                                type: "string",
                                title: "Cluster Name",
                                description: "Name for the cluster (letters, numbers, hyphens, 1–64 chars)",
                            },
                        },
                        required: ["name"],
                    }
                );
                if (!result.accepted) {
                    return { content: [{ type: "text", text: "Operation cancelled." }] };
                }
                name = result.fields.name;
                if (!name) {
                    return { content: [{ type: "text", text: "Operation cancelled." }] };
                }
            } else {
                return {
                    content: [
                        {
                            type: "text",
                            text: "To create a dedicated cluster I need:\n- name: cluster name (letters, numbers, hyphens)",
                        },
                    ],
                };
            }
        }

        // Phase 2: validate before any API call
        const instanceSizeNum = parseInstanceSizeNum(instanceSize);
        const maxInstanceSizeNum = parseInstanceSizeNum(autoScalingMaxInstanceSize);

        if (numShards > 1 && instanceSizeNum < 30) {
            return {
                content: [
                    {
                        type: "text",
                        text: `Sharded clusters (numShards ≥ 2) require M30 or larger instance size. Got: ${instanceSize}.`,
                    },
                ],
                isError: true,
            };
        }
        if (autoScaling && maxInstanceSizeNum < instanceSizeNum) {
            return {
                content: [
                    {
                        type: "text",
                        text: `autoScalingMaxInstanceSize (${autoScalingMaxInstanceSize}) must be greater than or equal to instanceSize (${instanceSize}).`,
                    },
                ],
                isError: true,
            };
        }
        if (versionReleaseSystem && mongoDBMajorVersion) {
            return {
                content: [
                    {
                        type: "text",
                        text: "versionReleaseSystem and mongoDBMajorVersion are mutually exclusive. Provide only one.",
                    },
                ],
                isError: true,
            };
        }
        if (pitEnabled && !backupEnabled) {
            return {
                content: [
                    {
                        type: "text",
                        text: "pitEnabled requires backupEnabled: true.",
                    },
                ],
                isError: true,
            };
        }

        // Phase 3: build body and call API
        const clusterType = numShards > 1 ? "SHARDED" : "REPLICASET";

        const primaryRegionConfig = {
            providerName: provider,
            regionName: region,
            priority: 7,
            electableSpecs: { instanceSize, nodeCount: 3 },
            ...(autoScaling && {
                autoScaling: {
                    compute: {
                        enabled: true,
                        scaleDownEnabled: true,
                        minInstanceSize: instanceSize,
                        maxInstanceSize: autoScalingMaxInstanceSize,
                    },
                    diskGB: { enabled: true },
                },
            }),
        };

        const regionConfigs = [
            primaryRegionConfig,
            ...additionalRegions.map((regionName, i) => ({
                ...primaryRegionConfig,
                regionName,
                priority: 6 - i,
            })),
        ];

        const replicationSpec = { zoneName: "Zone 1", regionConfigs };

        const body = {
            name,
            clusterType,
            terminationProtectionEnabled,
            backupEnabled,
            ...(pitEnabled && { pitEnabled }),
            replicationSpecs: Array.from({ length: numShards }, () => structuredClone(replicationSpec)),
            ...(mongoDBMajorVersion && { mongoDBMajorVersion }),
            ...(versionReleaseSystem && { versionReleaseSystem }),
        } as unknown as ClusterDescription20240805;

        await this.apiClient.createCluster({
            params: { path: { groupId: projectId } },
            body,
        });

        const additionalRegionsText =
            additionalRegions.length > 0 ? ` + ${additionalRegions.join(", ")}` : "";
        const autoScalingText = autoScaling ? `up to ${autoScalingMaxInstanceSize}` : "disabled";
        const clusterTypeText = numShards > 1 ? `SHARDED (${numShards} shards)` : "REPLICASET";

        return {
            content: [
                {
                    type: "text",
                    text: [
                        `Cluster "${name}" creation initiated.`,
                        `- Type: ${clusterTypeText}`,
                        `- Provider: ${provider} | Region: ${region}${additionalRegionsText}`,
                        `- Instance size: ${instanceSize} | Autoscaling: ${autoScalingText}`,
                        `- Backup: ${backupEnabled ? "enabled" : "disabled"}`,
                        ``,
                        `Status: CREATING — typically takes 7-10 minutes.`,
                        `Use atlas-inspect-cluster to check status, or atlas-connect-cluster to connect (it will wait until the cluster is ready).`,
                    ].join("\n"),
                },
            ],
        };
    }
}
