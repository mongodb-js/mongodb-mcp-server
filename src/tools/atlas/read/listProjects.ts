import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { AtlasToolBase } from "../atlasTool.js";
import type { OperationType } from "../../tool.js";
import { formatUntrustedData } from "../../tool.js";
import type { ToolArgs } from "../../tool.js";
import { AtlasArgs } from "../../args.js";

export class ListProjectsTool extends AtlasToolBase {
    public name = "atlas-list-projects";
    protected description = "List MongoDB Atlas projects";
    public operationType: OperationType = "read";
    protected argsShape = {
        orgId: AtlasArgs.organizationId()
            .describe("Atlas organization ID to filter projects. If not provided, projects for all orgs are returned.")
            .optional(),
    };

    protected async execute({ orgId }: ToolArgs<typeof this.argsShape>): Promise<CallToolResult> {
        const orgData = await this.session.apiClient.listOrganizations();

        if (!orgData?.results?.length) {
            return {
                content: [{ type: "text", text: "No organizations found in your MongoDB Atlas account." }],
            };
        }

        const orgs: Record<string, string> = orgData.results
            .filter((org) => org.id)
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            .reduce((acc, org) => ({ ...acc, [org.id!]: org.name }), {});

        const data = orgId
            ? await this.session.apiClient.listOrganizationProjects({
                  params: {
                      path: {
                          orgId,
                      },
                  },
              })
            : await this.session.apiClient.listProjects();

        if (!data?.results?.length) {
            return {
                content: [{ type: "text", text: `No projects found in organization ${orgId}.` }],
            };
        }

        const serializedProjects = JSON.stringify(
            data.results.map((project) => ({
                name: project.name,
                id: project.id,
                orgId: project.orgId,
                orgName: orgs[project.orgId] ?? "N/A",
                created: project.created ? new Date(project.created).toLocaleString() : "N/A",
            })),
            null,
            2
        );
        return {
            content: formatUntrustedData(`Found ${data.results.length} projects`, serializedProjects),
        };
    }
}
