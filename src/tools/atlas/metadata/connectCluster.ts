import { z } from "zod";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { AtlasToolBase } from "../atlasTool.js";
import { ToolArgs, OperationType } from "../../tool.js";
import { generateSecurePassword } from "../../../common/atlas/generatePassword.js";
import logger, { LogId } from "../../../logger.js";
import { inspectCluster } from "../../../common/atlas/cluster.js";

const EXPIRY_MS = 1000 * 60 * 60 * 12; // 12 hours

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export class ConnectClusterTool extends AtlasToolBase {
    protected name = "atlas-connect-cluster";
    protected description = "Connect to MongoDB Atlas cluster";
    protected operationType: OperationType = "metadata";
    protected argsShape = {
        projectId: z.string().describe("Atlas project ID"),
        clusterName: z.string().describe("Atlas cluster name"),
    };

    private async queryConnection(projectId: string, clusterName: string) : Promise<"connected" | "disconnected" | "connecting" | "connected-to-other-cluster"> {
        if (!this.session.connectedAtlasCluster) {
            return "disconnected";
        }

        if (this.session.connectedAtlasCluster.projectId !== projectId || this.session.connectedAtlasCluster.clusterName !== clusterName) {
            return "connected-to-other-cluster";
        }

        if (!this.session.serviceProvider) {
            return "connecting";
        }

        await this.session.serviceProvider.runCommand("admin", {
            ping: 1,
        });
        return "connected";
    }

    private async prepareClusterConnection(projectId: string, clusterName: string) : Promise<string> {
        await this.session.disconnect();

        const cluster = await inspectCluster(this.session.apiClient, projectId, clusterName);

        if (!cluster.connectionString) {
            throw new Error("Connection string not available");
        }

        const username = `mcpUser${Math.floor(Math.random() * 100000)}`;
        const password = await generateSecurePassword();

        const expiryDate = new Date(Date.now() + EXPIRY_MS);

        const readOnly =
            this.config.readOnly ||
            (this.config.disabledTools?.includes("create") &&
                this.config.disabledTools?.includes("update") &&
                this.config.disabledTools?.includes("delete") &&
                !this.config.disabledTools?.includes("read") &&
                !this.config.disabledTools?.includes("metadata"));

        const roleName = readOnly ? "readAnyDatabase" : "readWriteAnyDatabase";

        await this.session.apiClient.createDatabaseUser({
            params: {
                path: {
                    groupId: projectId,
                },
            },
            body: {
                databaseName: "admin",
                groupId: projectId,
                roles: [
                    {
                        roleName,
                        databaseName: "admin",
                    },
                ],
                scopes: [{ type: "CLUSTER", name: clusterName }],
                username,
                password,
                awsIAMType: "NONE",
                ldapAuthType: "NONE",
                oidcAuthType: "NONE",
                x509Type: "NONE",
                deleteAfterDate: expiryDate.toISOString(),
            },
        });

        this.session.connectedAtlasCluster = {
            username,
            projectId,
            clusterName,
            expiryDate,
        };

        const cn = new URL(cluster.connectionString);
        cn.username = username;
        cn.password = password;
        cn.searchParams.set("authSource", "admin");
        const connectionString = cn.toString();

        return connectionString;
    }

    private async connectToCluster(connectionString: string): Promise<void> {
        let lastError: Error | undefined = undefined;

        for (let i = 0; i < 600; i++) { // try for 5 minutes
            try {
                await this.session.connectToMongoDB(connectionString, this.config.connectOptions);
                lastError = undefined;
                break;
            } catch (err: unknown) {
                const error = err instanceof Error ? err : new Error(String(err));

                lastError = error;

                logger.debug(
                    LogId.atlasConnectFailure,
                    "atlas-connect-cluster",
                    `error connecting to cluster: ${error.message}`
                );

                await sleep(500); // wait for 500ms before retrying
            }
        }
    
        if (lastError) {
            void this.session.apiClient.deleteDatabaseUser({
                params: {
                    path: {
                        groupId: this.session.connectedAtlasCluster?.projectId || "",
                        username: this.session.connectedAtlasCluster?.username || "",
                        databaseName: "admin",
                    },
                },
            }).catch((err: unknown) => {
                const error = err instanceof Error ? err : new Error(String(err));
                logger.debug(
                    LogId.atlasConnectFailure,
                    "atlas-connect-cluster",
                    `error deleting database user: ${error.message}`
                );
            });
            this.session.connectedAtlasCluster = undefined;
            throw lastError;
        }
    }
    
    protected async execute({ projectId, clusterName }: ToolArgs<typeof this.argsShape>): Promise<CallToolResult> {
        try {
            const state = await this.queryConnection(projectId, clusterName);
            switch (state) {
                case "connected":
                    return {
                        content: [
                            {
                                type: "text",
                                text: "Cluster is already connected.",
                            },
                        ],
                    };
                case "connecting":
                    return {
                        content: [
                            {
                                type: "text",
                                text: "Cluster is connecting...",
                            },
                        ],
                    };
            }
        } catch (err: unknown) {
            const error = err instanceof Error ? err : new Error(String(err));
            logger.debug(
                LogId.atlasConnectFailure,
                "atlas-connect-cluster",
                `error querying cluster: ${error.message}`
            );
            // fall through to create new connection
        }

        const connectionString = await this.prepareClusterConnection(projectId, clusterName);
        process.nextTick(async () => {
            try {
                await this.connectToCluster(connectionString);
            } catch (err: unknown) {
                const error = err instanceof Error ? err : new Error(String(err));
                logger.debug(
                    LogId.atlasConnectFailure,
                    "atlas-connect-cluster",
                    `error connecting to cluster: ${error.message}`
                );
            }
        });

        return {
            content: [
                {
                    type: "text",
                    text: `Connecting to cluster "${clusterName}"...`,
                },
            ],
        };
    }
}
