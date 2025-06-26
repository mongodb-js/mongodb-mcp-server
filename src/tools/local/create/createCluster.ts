import { exec } from "child_process";
import { promisify } from "util";
import * as net from "net";
import { z } from "zod";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { LocalToolBase } from "../localTool.js";
import { ToolArgs, OperationType } from "../../tool.js";

export class CreateClusterTool extends LocalToolBase {
    protected name = "local-create-cluster";
    protected description = "Create a new local MongoDB cluster";
    protected operationType: OperationType = "create";
    protected argsShape = {
        name: z.string().describe("Name of the cluster"),
        port: z.number().describe("The port number on which the local MongoDB cluster will run.").optional(),
    };

    protected async execute({ name, port }: ToolArgs<typeof this.argsShape>): Promise<CallToolResult> {
        const availablePort = await this.getAvailablePort(port);
        const result = await this.createCluster(name, availablePort);
        return this.formatCreateClusterResult(result);
    }

    private async getAvailablePort(port?: number): Promise<number> {
        if (port) {
            const isAvailable = await this.isPortAvailable(port);
            if (!isAvailable) {
                throw new Error(`Port ${port} is already in use. Please specify a different port.`);
            }
            return port;
        }

        // Find a random available port
        return new Promise((resolve, reject) => {
            const server = net.createServer();
            server.listen(0, () => {
                const address = server.address();
                if (typeof address === "object" && address?.port) {
                    const randomPort = address.port;
                    server.close(() => resolve(randomPort));
                } else {
                    reject(new Error("Failed to find an available port."));
                }
            });
            server.on("error", reject);
        });
    }

    private async isPortAvailable(port: number): Promise<boolean> {
        return new Promise((resolve) => {
            const server = net.createServer();
            server.once("error", () => resolve(false)); // Port is in use
            server.once("listening", () => {
                server.close(() => resolve(true)); // Port is available
            });
            server.listen(port);
        });
    }

    private async createCluster(clusterName: string, port: number): Promise<{ success: boolean; message: string }> {
        const execAsync = promisify(exec);

        try {
            // Run the Docker command to create a new MongoDB container
            await execAsync(`docker run -d --name ${clusterName} -p ${port}:27017 mongodb/mongodb-atlas-local:8.0`);

            return {
                success: true,
                message: `Cluster "${clusterName}" created successfully on port ${port}.`,
            };
        } catch (error) {
            if (error instanceof Error) {
                return {
                    success: false,
                    message: `Failed to create cluster "${clusterName}": ${error.message}`,
                };
            } else {
                return {
                    success: false,
                    message: `An unexpected error occurred while creating cluster "${clusterName}".`,
                };
            }
        }
    }

    private formatCreateClusterResult(result: { success: boolean; message: string }): CallToolResult {
        return {
            content: [
                {
                    type: "text",
                    text: result.message,
                },
            ],
        };
    }
}
