import { exec } from "child_process";
import { promisify } from "util";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { ClusterDetails } from "../../../common/local/dockerUtils.js";
import { LocalToolBase, DockerPsSummary } from "../localTool.js";
import { OperationType } from "../../tool.js";

export class ListClustersTool extends LocalToolBase {
    protected name = "local-list-clusters";
    protected description = "List local MongoDB clusters";
    protected operationType: OperationType = "read";
    protected argsShape = {};

    protected async execute(): Promise<CallToolResult> {
        const clusters = await this.getLocalMongoDBClusters();
        return this.formatClustersTable(clusters);
    }

    private async getLocalMongoDBClusters(): Promise<ClusterDetails[]> {
        const execAsync = promisify(exec);
        // List all containers
        const { stdout } = await execAsync("docker ps -a --format '{{json .}}'");
        const lines = stdout.trim().split("\n");

        const clusters: ClusterDetails[] = [];

        for (const line of lines) {
            try {
                const container = JSON.parse(line) as DockerPsSummary;
                if (!container.Image.startsWith("mongodb")) {
                    continue; // Skip non-MongoDB containers
                }

                // Extract MongoDB version from the Image field
                const mongodbVersionMatch = container.Image.match(/mongodb\/mongodb-atlas-local:(.+)/);
                const mongodbVersion = mongodbVersionMatch ? mongodbVersionMatch[1] : "Unknown";

                // Extract port (if available)
                const portMatch = container.Ports?.match(/(?:\d{1,3}\.){3}\d{1,3}:(\d+)->27017\/tcp/);
                const port = portMatch ? portMatch[1] : null;

                // Extract health status using docker inspect
                const { stdout: statusOutput } = await execAsync(
                    `docker inspect -f '{{.State.Status}}' ${container.Names}`
                );
                const healthStatus = statusOutput.trim();

                const cluster: ClusterDetails = {
                    name: container.Names,
                    mongodbVersion,
                    status: healthStatus,
                    health: "",
                    port: port ? port : "Unknown",
                    dbUser: "",
                    isAuth: false,
                };

                clusters.push(cluster);
            } catch {
                console.warn(`Failed to parse line: ${line}`);
            }
        }

        return clusters;
    }

    private formatClustersTable(clusters: ClusterDetails[]): CallToolResult {
        const rows = clusters
            .map((c) => `${c.name.padEnd(15)}| ${c.status.padEnd(20)}| ${c.mongodbVersion.padEnd(20)}| ${c.port}`)
            .join("\n");

        return {
            content: [
                {
                    type: "text",
                    text: `Here are your local MongoDB clusters:\n${rows}`,
                },
                {
                    type: "text",
                    text: `Cluster Name | Status | MongoDB Version | Port
----------------|----------------|----------------|----------------
${rows}`,
                },
            ],
        };
    }
}
