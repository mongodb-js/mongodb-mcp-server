import { z } from "zod";
import { AtlasToolBase } from "../../atlasTool.js";
import type { OperationType } from "@mongodb-js/mcp-types";
import { formatUntrustedData } from "@mongodb-js/mcp-core";
import type { ToolArgs, ToolResult } from "@mongodb-js/mcp-core";
import { AtlasArgs } from "../../args.js";
import type { ToolExecutionContext } from "@mongodb-js/mcp-types";

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
    totalCount: z.number(),
};

export class ListProjectsTool extends AtlasToolBase {
    static toolName = "atlas-list-projects";
    public description = "List MongoDB Atlas projects";
    static operationType: OperationType = "read";
    public argsShape = {
        orgId: AtlasArgs.organizationId()
            .describe("Atlas organization ID to filter projects. If not provided, projects for all orgs are returned.")
            .optional(),
    };
    public override outputSchema = ListProjectsOutputSchema;

    protected async execute(
        { orgId }: ToolArgs<typeof this.argsShape>,
        context: ToolExecutionContext
    ): Promise<ToolResult<typeof this.outputSchema>> {
        const orgData = await this.apiClient.listOrgs(undefined, context);

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
                              itemsPerPage: 500,
                          },
                      },
                  },
                  context
              )
            : await this.apiClient.listGroups(
                  {
                      params: {
                          query: {
                              itemsPerPage: 500,
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
                    totalCount: 0,
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
            content: formatUntrustedData(`Found ${data.results.length} projects`, JSON.stringify(projects, null, 2)),
            structuredContent: {
                ...(orgId !== undefined && { orgId }),
                projects,
                totalCount: projects.length,
            },
        };
    }
}
