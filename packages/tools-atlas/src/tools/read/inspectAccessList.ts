import { z } from "zod";
import type { ToolArgs, ToolExecutionContext, ToolResult } from "@mongodb-js/mcp-core";
import { formatUntrustedData } from "@mongodb-js/mcp-core";
import type { OperationType } from "@mongodb-js/mcp-types";
import { AtlasToolBase } from "../../atlasTool.js";
import { AtlasArgs } from "../../args.js";

export const InspectAccessListArgs = {
    projectId: AtlasArgs.projectId().describe("Atlas project ID"),
};

const InspectAccessListOutputSchema = {
    projectId: z.string(),
    entries: z.array(
        z.object({
            ipAddress: z.string().optional(),
            cidrBlock: z.string().optional(),
            comment: z.string().optional(),
        })
    ),
    totalCount: z.number(),
};

export class InspectAccessListTool extends AtlasToolBase {
    static toolName = "atlas-inspect-access-list";
    public description = "Inspect Ip/CIDR ranges with access to your MongoDB Atlas clusters.";
    static operationType: OperationType = "read";
    public argsShape = {
        ...InspectAccessListArgs,
    };
    public override outputSchema = InspectAccessListOutputSchema;

    protected async execute(
        { projectId }: ToolArgs<typeof this.argsShape>,
        context: ToolExecutionContext
    ): Promise<ToolResult<typeof this.outputSchema>> {
        const accessList = await this.apiClient.listAccessListEntries(
            {
                params: {
                    path: {
                        groupId: projectId,
                    },
                },
            },
            context
        );

        const results = accessList.results ?? [];

        if (!results.length) {
            return {
                content: [{ type: "text", text: "No access list entries found." }],
                structuredContent: {
                    projectId,
                    entries: [],
                    totalCount: 0,
                },
            };
        }

        const entries = results.map((entry) => ({
            ipAddress: entry.ipAddress,
            cidrBlock: entry.cidrBlock,
            comment: entry.comment,
        }));

        return {
            content: formatUntrustedData(`Found ${results.length} access list entries`, JSON.stringify(entries)),
            structuredContent: {
                projectId,
                entries,
                totalCount: entries.length,
            },
        };
    }
}
