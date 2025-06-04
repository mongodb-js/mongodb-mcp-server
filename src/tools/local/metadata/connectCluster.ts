import { z } from "zod";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import logger, { LogId } from "../../../logger.js";
import { getValidatedClusterDetails } from "../../../common/local/dockerUtils.js";
import { LocalToolBase } from "../localTool.js";
import { OperationType } from "../../tool.js";

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export class ConnectClusterTool extends LocalToolBase {
    protected name = "local-connect-cluster";
    protected description = "Connect to a local MongoDB cluster";
    protected operationType: OperationType = "metadata";
    protected argsShape = {
        clusterName: z.string().describe("Local cluster name"),
        password: z.string().optional().describe("Password for the cluster if authentication is required"),
    };

    protected async execute({
        clusterName,
        password,
    }: {
        clusterName: string;
        password?: string;
    }): Promise<CallToolResult> {
        const clusterDetails = await getValidatedClusterDetails(clusterName);

        if (clusterDetails.isAuth && !password) {
            throw new Error(`Cluster "${clusterName}" requires authentication. Please provide a password.`);
        }

        const authPart = clusterDetails.isAuth ? `${clusterDetails.dbUser}:${password}@` : "";
        const connectionString = `mongodb://${authPart}localhost:${clusterDetails.port}/?directConnection=true`;

        return await this.connectToCluster(connectionString, clusterName);
    }

    private async connectToCluster(connectionString: string, clusterName: string): Promise<CallToolResult> {
        let lastError: Error | undefined = undefined;

        for (let i = 0; i < 20; i++) {
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
            throw lastError;
        }

        return {
            content: [
                {
                    type: "text",
                    text: `Connected to cluster "${clusterName}" with connection string: ${connectionString}`,
                },
            ],
        };
    }
}
