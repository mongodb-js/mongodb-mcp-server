import { z } from "zod";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { getValidatedClusterDetails, ClusterDetails } from "../../../common/local/dockerUtils.js";
import { LocalToolBase } from "../localTool.js";
import { OperationType } from "../../tool.js";

export class InspectClusterTool extends LocalToolBase {
    protected name = "local-inspect-cluster";
    protected description = "Inspect a specific local MongoDB cluster";
    protected operationType: OperationType = "read";
    protected argsShape = {
        clusterName: z.string().nonempty("Cluster name is required"),
    };

    protected async execute({ clusterName }: { clusterName: string }): Promise<CallToolResult> {
        const cluster = await getValidatedClusterDetails(clusterName);
        return this.formatClusterDetails(cluster);
    }

    private formatClusterDetails(cluster: ClusterDetails): CallToolResult {
        const connectionString =
            cluster.port.toLowerCase() === "unknown"
                ? null
                : `mongodb://localhost:${cluster.port}/?directConnection=true`;

        const connectionStringText = connectionString
            ? `Connection String: ${connectionString}`
            : "Connection String: Not available";

        return {
            content: [
                {
                    type: "text",
                    text: `Details for cluster "${cluster.name}":\n
Cluster Name: ${cluster.name}
MongoDB Version: ${cluster.mongodbVersion}
Status: ${cluster.status}
Health: ${cluster.health}
Port: ${cluster.port}
DBUser: ${cluster.dbUser}
${connectionStringText}`,
                },
            ],
        };
    }
}
