import { z } from "zod";
import { type OperationType, type ToolArgs, type ToolExecutionContext, type ToolResult } from "../../tool.js";
import { AtlasToolBase } from "../atlasTool.js";
import type { Group } from "../../../common/atlas/openapi.js";
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

    protected async execute(
        { projectName, orgId }: ToolArgs<typeof this.argsShape>,
        context: ToolExecutionContext
    ): Promise<ToolResult<typeof this.outputSchema>> {
        let assumedOrg = false;

        if (!projectName) {
            projectName = "Atlas Project";
        }

        if (!orgId) {
            try {
                const organizations = await this.apiClient.listOrgs(undefined, context);
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
            orgId: orgId,
        } as Group;

        const group = await this.apiClient.createGroup(
            {
                body: input,
            },
            context
        );

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
                ...(assumedOrg && { orgId }),
            },
        };
    }
}
