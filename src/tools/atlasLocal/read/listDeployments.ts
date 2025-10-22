import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { AtlasLocalToolBase } from "../atlasLocalTool.js";
import type { OperationType } from "../../tool.js";
import { formatUntrustedData } from "../../tool.js";
import type { Deployment } from "@mongodb-js/atlas-local";
import type { Client } from "@mongodb-js/atlas-local";

export class ListDeploymentsTool extends AtlasLocalToolBase {
    public name = "atlas-local-list-deployments";
    protected description = "List MongoDB Atlas local deployments";
    public operationType: OperationType = "read";
    protected argsShape = {};

    protected async executeWithAtlasLocalClient(client: Client): Promise<CallToolResult> {
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
        };
    }
}
