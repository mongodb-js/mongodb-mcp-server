import { z } from "zod";
import { type OperationType, type ToolArgs, type ToolExecutionContext, type ToolResult } from "../../tool.js";
import { AtlasToolBase } from "../atlasTool.js";
import type { Group } from "../../../common/atlas/openapi.js";
import { AtlasArgs } from "../../args.js";

const CreateProjectOutputSchema = {
    projectName: z.string(),
    orgId: z.string(),
};

export class CreateProjectTool extends AtlasToolBase {
    static toolName = "atlas-create-project";
    public description = "Create a MongoDB Atlas project";
    static operationType: OperationType = "create";
    public argsShape = {
        projectName: AtlasArgs.projectName().describe("Name for the new project"),
        orgId: AtlasArgs.organizationId().describe("Organization ID that will own the new project"),
    };
    public override outputSchema = CreateProjectOutputSchema;

    protected async execute(
        { projectName, orgId }: ToolArgs<typeof this.argsShape>,
        context: ToolExecutionContext
    ): Promise<ToolResult<typeof this.outputSchema>> {
        const input = {
            name: projectName,
            orgId,
        } as Group;

        const group = await this.apiClient.createGroup({ body: input }, context);

        if (!group?.id) {
            throw new Error("Failed to create project");
        }

        return {
            content: [
                {
                    type: "text",
                    text: `Project "${projectName}" created successfully.`,
                },
            ],
            structuredContent: {
                projectName,
                orgId,
            },
        };
    }
}
