import { z } from "zod";
import { AtlasToolBase } from "../atlasTool.js";
import type { OperationType, ToolArgs, ToolExecutionContext, ToolResult } from "../../tool.js";
import { formatUntrustedData } from "../../tool.js";

export const ListOrganizationsArgs = {
    limit: z.number().int().min(1).max(500).default(100).describe("Max number of organizations to return per page."),
    pageNum: z.number().int().min(1).default(1).describe("Page number of organizations to return."),
};

const ListOrganizationsOutputSchema = {
    organizations: z.array(
        z.object({
            name: z.string().optional(),
            id: z.string().optional(),
        })
    ),
    totalCount: z.number().optional(),
};

export class ListOrganizationsTool extends AtlasToolBase {
    static toolName = "atlas-list-orgs";
    public description = "List MongoDB Atlas organizations";
    static operationType: OperationType = "read";
    public argsShape = {
        ...ListOrganizationsArgs,
    };
    public override outputSchema = ListOrganizationsOutputSchema;

    protected async execute(
        { limit, pageNum }: ToolArgs<typeof this.argsShape>,
        context: ToolExecutionContext
    ): Promise<ToolResult<typeof this.outputSchema>> {
        const data = await this.apiClient.listOrgs(
            {
                params: {
                    query: {
                        itemsPerPage: limit,
                        pageNum,
                        includeCount: true,
                    },
                },
            },
            context
        );

        if (!data?.results?.length) {
            return {
                content: [{ type: "text", text: "No organizations found in your MongoDB Atlas account." }],
                structuredContent: {
                    organizations: [],
                    ...(data?.totalCount !== undefined && { totalCount: data.totalCount }),
                },
            };
        }

        const orgs = data.results.map((org) => ({
            name: org.name,
            id: org.id,
        }));

        return {
            content: formatUntrustedData(
                `Found ${data.results.length} organizations in your MongoDB Atlas account${
                    data.totalCount !== undefined ? ` (total: ${data.totalCount})` : ""
                }.`,
                JSON.stringify(orgs)
            ),
            structuredContent: {
                organizations: orgs,
                ...(data.totalCount !== undefined && { totalCount: data.totalCount }),
            },
        };
    }
}
