import { z } from "zod";
import type { OperationType, ToolExecutionContext } from "@mongodb-js/mcp-types";
import { AtlasToolBase } from "../../atlasTool.js";
import { type ToolArgs, type ToolResult, formatUntrustedData } from "@mongodb-js/mcp-core";

export const ListOrganizationsArgs = {
    limit: z.number().int().min(1).max(500).default(10).describe("Max number of organizations to return per page."),
    pageNum: z.number().int().min(1).default(1).describe("Page number of organizations to return."),
    includeCount: z
        .boolean()
        .default(false)
        .describe(
            "Whether to include the total number of matching organizations. Note: enabling this makes the API request take much longer."
        ),
};

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
    public argsShape = {
        ...ListOrganizationsArgs,
    };
    public override outputSchema = ListOrganizationsOutputSchema;

    protected async execute(
        { limit, pageNum, includeCount }: ToolArgs<typeof this.argsShape>,
        context: ToolExecutionContext
    ): Promise<ToolResult<typeof this.outputSchema>> {
        const data = await this.apiClient.listOrgs(
            {
                params: {
                    query: {
                        itemsPerPage: limit,
                        pageNum,
                        includeCount,
                    },
                },
            },
            context
        );

        const orgs = (data?.results ?? []).map((org) => ({
            name: org.name,
            id: org.id,
        }));
        const totalCount = data?.totalCount ?? orgs.length;
        // Without includeCount the API omits totalCount, so a full page is the signal
        // that more results may exist on later pages.
        const moreResultsAvailable =
            data?.totalCount !== undefined
                ? (pageNum - 1) * limit + orgs.length < data.totalCount
                : orgs.length === limit;

        if (!orgs.length) {
            return {
                content: [{ type: "text", text: "No organizations found in your MongoDB Atlas account." }],
                structuredContent: {
                    organizations: [],
                    totalCount: 0,
                },
            };
        }

        return {
            content: formatUntrustedData(
                `Found ${orgs.length} organizations in your MongoDB Atlas account.${
                    moreResultsAvailable ? " Use pagination arguments if more results are expected." : ""
                }`,
                JSON.stringify(orgs)
            ),
            structuredContent: {
                organizations: orgs,
                totalCount,
            },
        };
    }
}
