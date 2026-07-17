import { z } from "zod";
import { AtlasToolBase } from "../atlasTool.js";
import type { OperationType, ToolArgs, ToolExecutionContext, ToolResult } from "../../tool.js";
import { formatUntrustedData } from "../../tool.js";
import { AtlasArgs } from "../../args.js";

// Atlas's max page size; used only to bound the internal orgId -> orgName lookup call below.
// Not user-facing pagination — see ListProjectsArgs.limit/pageNum for that.
const ORG_LOOKUP_ITEMS_PER_PAGE = 500;

export const ListProjectsArgs = {
    orgId: AtlasArgs.organizationId()
        .describe("Atlas organization ID to filter projects. If not provided, projects for all orgs are returned.")
        .optional(),
    limit: z.number().int().min(1).max(500).default(10).describe("Max number of projects to return per page."),
    pageNum: z.number().int().min(1).default(1).describe("Page number of projects to return."),
};

const ListProjectsOutputSchema = {
    orgId: z.string().optional(),
    projects: z.array(
        z.object({
            name: z.string(),
            id: z.string().optional(),
            orgId: z.string(),
            orgName: z.string(),
            created: z.string(),
        })
    ),
    totalCount: z.number().optional(),
};

export class ListProjectsTool extends AtlasToolBase {
    static toolName = "atlas-list-projects";
    public description = "List MongoDB Atlas projects";
    static operationType: OperationType = "read";
    public argsShape = {
        ...ListProjectsArgs,
    };
    public override outputSchema = ListProjectsOutputSchema;

    protected async execute(
        { orgId, limit, pageNum }: ToolArgs<typeof this.argsShape>,
        context: ToolExecutionContext
    ): Promise<ToolResult<typeof this.outputSchema>> {
        const orgData = await this.apiClient.listOrgs(
            {
                params: {
                    query: {
                        itemsPerPage: ORG_LOOKUP_ITEMS_PER_PAGE,
                    },
                },
            },
            context
        );

        if (!orgData?.results?.length) {
            return {
                content: [{ type: "text", text: "No organizations found in your MongoDB Atlas account." }],
                structuredContent: {
                    ...(orgId !== undefined && { orgId }),
                    projects: [],
                    totalCount: 0,
                },
            };
        }

        const orgs: Record<string, string> = orgData.results
            .filter((org) => org.id)
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            .reduce((acc, org) => ({ ...acc, [org.id!]: org.name }), {});

        const data = orgId
            ? await this.apiClient.getOrgGroups(
                  {
                      params: {
                          path: {
                              orgId,
                          },
                          query: {
                              itemsPerPage: limit,
                              pageNum,
                              includeCount: true,
                          },
                      },
                  },
                  context
              )
            : await this.apiClient.listGroups(
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
                content: [{ type: "text", text: `No projects found in organization ${orgId}.` }],
                structuredContent: {
                    ...(orgId !== undefined && { orgId }),
                    projects: [],
                    totalCount: data?.totalCount ?? 0,
                },
            };
        }

        const projects = data.results.map((project) => ({
            name: project.name,
            id: project.id,
            orgId: project.orgId,
            orgName: orgs[project.orgId] ?? "N/A",
            created: project.created ? new Date(project.created).toLocaleString() : "N/A",
        }));

        return {
            content: formatUntrustedData(
                `Found ${data.results.length} projects${
                    data.totalCount !== undefined ? ` (total: ${data.totalCount})` : ""
                }`,
                JSON.stringify(projects, null, 2)
            ),
            structuredContent: {
                ...(orgId !== undefined && { orgId }),
                projects,
                ...(data.totalCount !== undefined && { totalCount: data.totalCount }),
            },
        };
    }
}
