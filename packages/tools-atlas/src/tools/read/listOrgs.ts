import { z } from "zod";
import type { OperationType, ToolExecutionContext } from "@mongodb-js/mcp-types";
import { AtlasToolBase } from "../../atlasTool.js";
import { type ToolArgs, type ToolResult, formatUntrustedData } from "@mongodb-js/mcp-core";

const ListOrganizationsOutputSchema = {
    organizations: z.array(
        z.object({
            name: z.string().optional(),
            id: z.string().optional(),
        })
    ),
    totalCount: z.number(),
};

export class ListOrganizationsTool extends AtlasToolBase {
    static toolName = "atlas-list-orgs";
    public description = "List MongoDB Atlas organizations";
    static operationType: OperationType = "read";
    public argsShape = {};
    public override outputSchema = ListOrganizationsOutputSchema;

    protected async execute(
        _args: ToolArgs<typeof this.argsShape>,
        context: ToolExecutionContext
    ): Promise<ToolResult<typeof this.outputSchema>> {
        const data = await this.apiClient.listOrgs(undefined, context);

        if (!data?.results?.length) {
            return {
                content: [{ type: "text", text: "No organizations found in your MongoDB Atlas account." }],
                structuredContent: {
                    organizations: [],
                    totalCount: 0,
                },
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
            structuredContent: {
                organizations: orgs,
                totalCount: orgs.length,
            },
        };
    }
}
