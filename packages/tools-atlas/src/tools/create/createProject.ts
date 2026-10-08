import { z } from "zod";
import { type ToolArgs, type ToolResult } from "@mongodb-js/mcp-core";
import type { OperationType, ToolExecutionContext } from "@mongodb-js/mcp-types";
import { AtlasToolBase } from "../../atlasTool.js";
import type { Group } from "@mongodb-js/mcp-atlas-api-client";
import { AtlasArgs } from "../../args.js";

const CreateProjectOutputSchema = {
    projectName: z.string(),
    orgId: z.string(),
};

const CreateProjectArgsShape = {
    projectName: AtlasArgs.projectName().describe("Name for the new project"),
    orgId: AtlasArgs.organizationId().describe("Organization ID that will own the new project"),
};

export class CreateProjectTool extends AtlasToolBase {
    static toolName = "atlas-create-project";
    public description = "Create a MongoDB Atlas project";
    static operationType: OperationType = "create";
    public argsShape(): typeof CreateProjectArgsShape {
        return CreateProjectArgsShape;
    }
    public override outputSchema(): typeof CreateProjectOutputSchema {
        return CreateProjectOutputSchema;
    }

    protected async execute(
        { projectName, orgId }: ToolArgs<ReturnType<typeof this.argsShape>>,
        { request }: ToolExecutionContext
    ): Promise<ToolResult<ReturnType<typeof this.outputSchema>>> {
        const input = {
            name: projectName,
            orgId,
        } as Group;

        const group = await this.server.apiClient.createGroup({ body: input }, request);

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
