import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { AtlasToolBase } from "../atlasTool.js";
import type { ToolArgs, OperationType } from "../../tool.js";
import { formatUntrustedData } from "../../tool.js";

export class InspectAccessListTool extends AtlasToolBase {
    public name = "atlas-inspect-access-list";
    protected description = "Inspect Ip/CIDR ranges with access to your MongoDB Atlas clusters.";
    public operationType: OperationType = "read";
    protected argsShape = {
        projectId: z.string().describe("Atlas project ID"),
    };

    protected async execute({ projectId }: ToolArgs<typeof this.argsShape>): Promise<CallToolResult> {
        const accessList = await this.session.apiClient.listProjectIpAccessLists({
            params: {
                path: {
                    groupId: projectId,
                },
            },
        });

        const results = accessList.results ?? [];

        if (!results.length) {
            return {
                content: [{ type: "text", text: "No access list entries found." }],
            };
        }

        return {
            content: formatUntrustedData(
                `Found ${results.length} access list entries`,
                `IP ADDRESS | CIDR | COMMENT
------|------|------
${results
    .map((entry) => {
        return `${entry.ipAddress} | ${entry.cidrBlock} | ${entry.comment}`;
    })
    .join("\n")}`
            ),
        };
    }
}
