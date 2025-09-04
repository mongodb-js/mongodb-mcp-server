import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { AtlasLocalToolBase } from "../atlasLocalTool.js";
import type { ToolArgs, OperationType, TelemetryToolMetadata } from "../../tool.js";
import { formatUntrustedData } from "../../tool.js";
import type { Deployment } from "@mongodb-js-preview/atlas-local";

export class ListDeploymentsTool extends AtlasLocalToolBase {
    public name = "atlas-local-list-deployments";
    protected description = "List MongoDB Atlas local deployments";
    public operationType: OperationType = "read";
    protected argsShape = {};

    protected async execute({}: ToolArgs<typeof this.argsShape>): Promise<CallToolResult> {
        // Get the client
        const client = this.client;

        // If the client is not found, throw an error
        // This should never happen, because the tool should have been disabled.
        // verifyAllowed in the base class returns false if the client is not found
        if (!client) {
            throw new Error("Atlas Local client not found, tool should have been disabled.");
        }
        
        // List the deployments
        const deployments = await client.listDeployments();

        // Format the deployments
        return this.formatDeploymentsTable(deployments);
    }


    private formatDeploymentsTable(
        deployments: Deployment[]
    ): CallToolResult {
        // Check if deployments are absent
        if (!deployments?.length) {
            return {
                content: [{ type: "text", text: "No deployments found." }],
            };
        }

        // Turn the deployments into a markdown table
        const rows = deployments
            .map((deployment) => {
                return `${deployment.name || "Unknown"} | ${deployment.state} | ${deployment.mongodbVersion}`
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
