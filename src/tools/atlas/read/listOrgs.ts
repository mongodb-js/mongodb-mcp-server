import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { AtlasToolBase } from "../atlasTool.js";
import type { OperationType, ToolArgs, ToolExecutionContext } from "../../tool.js";
import { formatUntrustedData } from "../../tool.js";

export class ListOrganizationsTool extends AtlasToolBase {
    static toolName = "atlas-list-orgs";
    public description = "List MongoDB Atlas organizations";
    static operationType: OperationType = "read";
    public argsShape = {};

    protected async execute(
        _args: ToolArgs<typeof this.argsShape>,
        context: ToolExecutionContext
    ): Promise<CallToolResult> {
        const data = await this.apiClient.listOrgs(undefined, context);

        if (!data?.results?.length) {
            return {
                content: [{ type: "text", text: "No organizations found in your MongoDB Atlas account." }],
            };
        }

        const orgs = data.results.map((org) => ({
            name: org.name,
            id: org.id,
        }));

        return {
            content: formatUntrustedData(
                `Found ${data.results.length} organizations in your MongoDB Atlas account.`,
                JSON.stringify(orgs)
            ),
        };
    }
}
