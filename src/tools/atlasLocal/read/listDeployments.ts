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

        // Turn the deployments into a markdown table
        const rows = deployments
            .map((deployment) => {
                return `${deployment.name || "Unknown"} | ${deployment.state} | ${deployment.mongodbVersion}`;
            })
            .join("\n");

        return {
            content: formatUntrustedData(
                `Found ${deployments.length} deployments:`,
                `Deployment Name | State | MongoDB Version
----------------|----------------|----------------
${rows}`
            ),
        };
    }
}
