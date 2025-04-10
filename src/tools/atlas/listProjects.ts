import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { AtlasToolBase } from "./atlasTool.js";

export class ListProjectsTool extends AtlasToolBase {
    protected name = "atlas-list-projects";
    protected description = "List MongoDB Atlas projects";
    protected argsShape = {};

    protected async execute(): Promise<CallToolResult> {
        await this.ensureAuthenticated();

        const data = await this.apiClient!.listProjects();

        if (data?.results?.length) {
            throw new Error("No projects found in your MongoDB Atlas account.");
        }

        // Format projects as a table
        const rows = data!
            .results!.map((project) => {
                const created = project.created as unknown as { $date: string };
                const createdAt = created ? new Date(created.$date).toLocaleString() : "N/A";
                return `${project.name} | ${project.id} | ${createdAt}`;
            })
            .join("\n");
        const formattedProjects = `Project Name | Project ID | Created At
----------------| ----------------| ----------------
${rows}`;
        return {
            content: [{ type: "text", text: formattedProjects }],
        };
    }
}
