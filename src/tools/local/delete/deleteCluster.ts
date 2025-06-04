import { promisify } from "util";
import { exec } from "child_process";
import { z } from "zod";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { LocalToolBase } from "../localTool.js";
import { OperationType } from "../../tool.js";

export class DeleteClusterTool extends LocalToolBase {
    protected name = "local-delete-cluster";
    protected description = "Delete a local MongoDB cluster";
    protected operationType: OperationType = "delete";
    protected argsShape = {
        clusterName: z.string().nonempty("Cluster name is required"),
    };

    protected async execute({ clusterName }: { clusterName: string }): Promise<CallToolResult> {
        const result = await this.deleteCluster(clusterName);
        return this.formatDeleteClusterResult(result, clusterName);
    }

    private async deleteCluster(clusterName: string): Promise<{ success: boolean; message: string }> {
        const execAsync = promisify(exec);

        try {
            console.log(`Deleting MongoDB cluster with name: ${clusterName}`);
            // Stop and remove the Docker container
            await execAsync(`docker rm -f ${clusterName}`);

            return {
                success: true,
                message: `Cluster "${clusterName}" deleted successfully.`,
            };
        } catch (error) {
            if (error instanceof Error) {
                console.error(`Failed to delete cluster "${clusterName}":`, error.message);
                return {
                    success: false,
                    message: `Failed to delete cluster "${clusterName}": ${error.message}`,
                };
            } else {
                console.error(`Unexpected error while deleting cluster "${clusterName}":`, error);
                return {
                    success: false,
                    message: `An unexpected error occurred while deleting cluster "${clusterName}".`,
                };
            }
        }
    }

    private formatDeleteClusterResult(
        result: { success: boolean; message: string },
        clusterName: string
    ): CallToolResult {
        return {
            content: [
                {
                    type: "text",
                    text: result.success
                        ? `Cluster "${clusterName}" has been deleted.`
                        : `Failed to delete cluster "${clusterName}": ${result.message}`,
                },
            ],
        };
    }
}
