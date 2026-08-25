import { z } from "zod";
import { AtlasToolBase } from "../../atlasTool.js";
import type { OperationType } from "@mongodb-js/mcp-types";
import { formatUntrustedData } from "@mongodb-js/mcp-core";
import type { ToolArgs, ToolResult } from "@mongodb-js/mcp-core";
import { AtlasArgs } from "../../args.js";
import type { ToolExecutionContext } from "@mongodb-js/mcp-types";

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
            created: z.string(),
        })
    ),
    totalCount: z.number(),
};

export class ListProjectsTool extends AtlasToolBase {
    static toolName = "atlas-list-projects";
    public description = "List MongoDB Atlas projects.";
    static operationType: OperationType = "read";
    public argsShape = {
        ...ListProjectsArgs,
    };
    public override outputSchema = ListProjectsOutputSchema;

    protected async execute(
        { orgId, limit, pageNum }: ToolArgs<typeof this.argsShape>,
        context: ToolExecutionContext
    ): Promise<ToolResult<typeof this.outputSchema>> {
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

        const projects = (data?.results ?? []).map((project) => ({
            name: project.name,
            id: project.id,
            orgId: project.orgId,
            created: project.created ? new Date(project.created).toLocaleString() : "N/A",
        }));
        const totalCount = data?.totalCount ?? projects.length;
        const moreResultsAvailable = (pageNum - 1) * limit + projects.length < totalCount;

        if (!projects.length) {
            return {
                content: [
                    {
                        type: "text",
                        text:
                            orgId !== undefined
                                ? `No projects found in organization ${orgId}.`
                                : "No projects found in your MongoDB Atlas account.",
                    },
                ],
                structuredContent: {
                    ...(orgId !== undefined && { orgId }),
                    projects: [],
                    totalCount: 0,
                },
            };
        }

        return {
            content: formatUntrustedData(
                `Found ${projects.length} of ${totalCount} projects.${
                    moreResultsAvailable ? " Use pagination if more results are needed." : ""
                }`,
                JSON.stringify(projects, null, 2)
            ),
            structuredContent: {
                ...(orgId !== undefined && { orgId }),
                projects,
                totalCount,
            },
        };
    }
}
