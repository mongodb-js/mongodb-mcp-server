import type { CallToolResult } from "@mongodb-js/mcp-types";
import { AtlasLocalToolBase } from "../../atlasLocalTool.js";
import type { ToolArgs } from "@mongodb-js/mcp-core";
import type { OperationType } from "@mongodb-js/mcp-types";
import { formatUntrustedData } from "@mongodb-js/mcp-core";
import type { Deployment } from "@mongodb-js/atlas-local";
import type { Client } from "@mongodb-js/atlas-local";
import { z } from "zod";

const ListDeploymentsOutputSchema = {
    count: z.number(),
    deployments: z.array(
        z.object({
            name: z.string(),
            state: z.string(),
            mongodbVersion: z.string(),
        })
    ),
};

export class ListDeploymentsTool extends AtlasLocalToolBase {
    static toolName = "atlas-local-list-deployments";
    public description = "List MongoDB Atlas local deployments";
    static operationType: OperationType = "read";
    public argsShape = {};
    public override outputSchema = ListDeploymentsOutputSchema;

    protected async executeWithAtlasLocalClient(
        _args: ToolArgs<typeof this.argsShape>,
        { client }: { client: Client }
    ): Promise<CallToolResult> {
        // List the deployments
        const deployments = await client.listDeployments();

        // Format the deployments
        return this.formatDeploymentsTable(deployments);
    }

    private formatDeploymentsTable(deployments: Deployment[]): CallToolResult {
        // Check if deployments are absent
        if (!deployments?.length) {
            return {
                content: [{ type: "text", text: "No deployments found." }],
                structuredContent: {
                    count: 0,
                    deployments: [],
                },
            };
        }

        // Filter out the fields we want to return to the user
        // We don't want to return the entire deployment object because it contains too much data
        const deploymentsJson = deployments.map((deployment) => {
            return {
                name: deployment.name,
                state: deployment.state,
                mongodbVersion: deployment.mongodbVersion,
            };
        });

        return {
            content: formatUntrustedData(`Found ${deployments.length} deployments`, JSON.stringify(deploymentsJson)),
            structuredContent: {
                count: deployments.length,
                deployments: deploymentsJson,
            },
        };
    }
}
