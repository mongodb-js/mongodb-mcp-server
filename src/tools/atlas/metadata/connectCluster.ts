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
    protected description = "Connect to / Inspect connection of MongoDB Atlas cluster";
    protected operationType: OperationType = "metadata";
    protected argsShape = {
        projectId: z.string().describe("Atlas project ID"),
        clusterName: z.string().describe("Atlas cluster name"),
    };

    private async queryConnection(
        projectId: string,
        clusterName: string
    ): Promise<"connected" | "disconnected" | "connecting" | "connected-to-other-cluster"> {
        if (!this.session.connectedAtlasCluster) {
            return "disconnected";
        }

        if (
            this.session.connectedAtlasCluster.projectId !== projectId ||
            this.session.connectedAtlasCluster.clusterName !== clusterName
        ) {
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

    private async prepareClusterConnection(projectId: string, clusterName: string): Promise<string> {
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
        return cn.toString();
    }

    private async connectToCluster(connectionString: string, tryCount: number): Promise<void> {
        let lastError: Error | undefined = undefined;

        logger.debug(
            LogId.atlasConnectAttempt,
            "atlas-connect-cluster",
            `attempting to connect to cluster: ${this.session.connectedAtlasCluster?.clusterName}`
        );

        for (let i = 0; i < tryCount; i++) {
            try {
                lastError = undefined;

                if (!this.session.connectedAtlasCluster) {
                    throw new Error("Cluster connection aborted");
                }

                await this.session.connectToMongoDB(connectionString, this.config.connectOptions);
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
            if (this.session.connectedAtlasCluster?.projectId && this.session.connectedAtlasCluster?.username) {
                void this.session.apiClient
                    .deleteDatabaseUser({
                        params: {
                            path: {
                                groupId: this.session.connectedAtlasCluster.projectId,
                                username: this.session.connectedAtlasCluster.username,
                                databaseName: "admin",
                            },
                        },
                    })
                    .catch((err: unknown) => {
                        const error = err instanceof Error ? err : new Error(String(err));
                        logger.debug(
                            LogId.atlasConnectFailure,
                            "atlas-connect-cluster",
                            `error deleting database user: ${error.message}`
                        );
                    });
            }
            this.session.connectedAtlasCluster = undefined;
            throw lastError;
        }

        logger.debug(
            LogId.atlasConnectSucceeded,
            "atlas-connect-cluster",
            `connected to cluster: ${this.session.connectedAtlasCluster?.clusterName}`
        );
    }

    protected async execute({ projectId, clusterName }: ToolArgs<typeof this.argsShape>): Promise<CallToolResult> {
        const connectingResult = {
            content: [
                {
                    type: "text" as const,
                    text: `Attempting to connect to cluster "${clusterName}"...`,
                },
                {
                    type: "text" as const,
                    text: `Warning: Provisioning a user and connecting to the cluster may take more time, please check again in a few seconds.`,
                },
            ],
        };

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
                    return connectingResult;
                case "connected-to-other-cluster":
                case "disconnected":
                default:
                    // fall through to create new connection
                    break;
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

        await this.session.disconnect();
        const connectionString = await this.prepareClusterConnection(projectId, clusterName);

        try {
            await this.connectToCluster(connectionString, 60);

            return {
                content: [
                    {
                        type: "text",
                        text: `Connected to cluster "${clusterName}".`,
                    },
                ],
            };
        } catch (err: unknown) {
            const error = err instanceof Error ? err : new Error(String(err));
            logger.debug(
                LogId.atlasConnectFailure,
                "atlas-connect-cluster",
                `error connecting to cluster: ${error.message}`
            );

            process.nextTick(async () => {
                try {
                    await this.connectToCluster(connectionString, 600);
                } catch (err: unknown) {
                    const error = err instanceof Error ? err : new Error(String(err));
                    logger.debug(
                        LogId.atlasConnectFailure,
                        "atlas-connect-cluster",
                        `error connecting to cluster: ${error.message}`
                    );
                }
            });

            return connectingResult;
        }
    }
}
