import { z } from "zod";
import type { CallToolResult } from "@mongodb-js/mcp-types";
import { type ToolArgs } from "@mongodb-js/mcp-core";
import type { OperationType } from "@mongodb-js/mcp-types";
import { AtlasToolBase } from "../../atlasTool.js";
import type { Group } from "@mongodb-js/mcp-atlas-api-client";
import { AtlasArgs } from "../../args.js";

const CreateProjectOutputSchema = {
    projectName: z.string(),
    orgId: z.string().optional(),
};

export class CreateProjectTool extends AtlasToolBase {
    static toolName = "atlas-create-project";
    public description = "Create a MongoDB Atlas project";
    static operationType: OperationType = "create";
    public argsShape = {
        projectName: AtlasArgs.projectName().optional().describe("Name for the new project"),
        orgId: AtlasArgs.organizationId().optional().describe("Organization ID for the new project"),
    };
    public override outputSchema = CreateProjectOutputSchema;

    protected async execute({ projectName, orgId }: ToolArgs<typeof this.argsShape>): Promise<CallToolResult> {
        let assumedOrg = false;

        if (!projectName) {
            projectName = "Atlas Project";
        }

        if (!orgId) {
            try {
                const organizations = await this.apiClient.listOrgs();
                if (!organizations?.results?.length) {
                    throw new Error(
                        "No organizations were found in your MongoDB Atlas account. Please create an organization first."
                    );
                }
                const firstOrg = organizations.results[0];
                if (!firstOrg?.id) {
                    throw new Error(
                        "The first organization found does not have an ID. Please check your Atlas account."
                    );
                }
                orgId = firstOrg.id;
                assumedOrg = true;
            } catch {
                throw new Error(
                    "Could not search for organizations in your MongoDB Atlas account, please provide an organization ID or create one first."
                );
            }
        }

        const input = {
            name: projectName,
            orgId,
        } as Group;

        const group = await this.apiClient.createGroup({
            body: input,
        });

        if (!group?.id) {
            throw new Error("Failed to create project");
        }

        return {
            content: [
                {
                    type: "text",
                    text: `Project "${projectName}" created successfully${assumedOrg ? ` (using orgId ${orgId}).` : ""}.`,
                },
            ],
            structuredContent: {
                projectName,
                ...(assumedOrg ? { orgId } : {}),
            },
        };
    }
}
