import fs from "fs/promises";
import path from "path";
import type { MongoClusterOptions } from "mongodb-runner";
import { MongoCluster } from "mongodb-runner";
import { Client as AtlasLocalClient } from "@mongodb-js/atlas-local";

export type MongoRunnerConfiguration = {
    runner: true;
    downloadOptions: MongoClusterOptions["downloadOptions"];
    serverArgs: string[];
};

export type MongoSearchConfiguration = { search: true; image?: string };
export type MongoClusterConfiguration = MongoRunnerConfiguration | MongoSearchConfiguration;

const DOWNLOAD_RETRIES = 10;

// Timeout for waiting until the Atlas Local deployment is healthy (2 minutes)
const ATLAS_LOCAL_HEALTH_TIMEOUT_MS = 120_000;

// Default image to use for Atlas Local deployments
// Using :8 tag to match the major MongoDB version we're testing against
const DEFAULT_ATLAS_LOCAL_IMAGE = "mongodb/mongodb-atlas-local:8";

export class MongoDBClusterProcess {
    static async spinUp(config: MongoClusterConfiguration): Promise<MongoDBClusterProcess> {
        if (MongoDBClusterProcess.isSearchOptions(config)) {
            const atlasLocalClient =  AtlasLocalClient.connect();
            const deployment = await atlasLocalClient.createDeployment({
                image: config.image ?? DEFAULT_ATLAS_LOCAL_IMAGE,
                waitUntilHealthy: true,
                waitUntilHealthyTimeout: ATLAS_LOCAL_HEALTH_TIMEOUT_MS,
                creationSource: { type: "MCPServer", source: "integration-tests" },
            });

            if (!deployment.name) {
                throw new Error("Deployment name is not set");
            }

            const connectionString = await atlasLocalClient.getConnectionString(deployment.name);

            return new MongoDBClusterProcess(
                async () => {
                    if (deployment.name) {
                        await atlasLocalClient.deleteDeployment(deployment.name);
                    }
                },
                () => connectionString
            );
        } else if (MongoDBClusterProcess.isMongoRunnerOptions(config)) {
            const { downloadOptions, serverArgs } = config;

            const tmpDir = path.join(__dirname, "..", "..", "..", "tmp");
            await fs.mkdir(tmpDir, { recursive: true });
            let dbsDir = path.join(tmpDir, "mongodb-runner", "dbs");
            for (let i = 0; i < DOWNLOAD_RETRIES; i++) {
                try {
                    const mongoCluster = await MongoCluster.start({
                        tmpDir: dbsDir,
                        logDir: path.join(tmpDir, "mongodb-runner", "logs"),
                        topology: "standalone",
                        version: downloadOptions?.version ?? "8.0.12",
                        downloadOptions,
                        args: serverArgs,
                    });

                    return new MongoDBClusterProcess(
                        () => mongoCluster.close(),
                        () => mongoCluster.connectionString
                    );
                } catch (err) {
                    if (i < 5) {
                        // Just wait a little bit and retry
                        // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
                        console.error(`Failed to start cluster in ${dbsDir}, attempt ${i}: ${err}`);
                        await new Promise((resolve) => setTimeout(resolve, 1000));
                    } else {
                        // If we still fail after 5 seconds, try another db dir
                        console.error(
                            // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
                            `Failed to start cluster in ${dbsDir}, attempt ${i}: ${err}. Retrying with a new db dir.`
                        );
                        dbsDir = path.join(tmpDir, "mongodb-runner", `dbs${i - 5}`);
                    }
                }
            }
            throw new Error(`Could not download cluster with configuration: ${JSON.stringify(config)}`);
        } else {
            throw new Error(`Unsupported configuration: ${JSON.stringify(config)}`);
        }
    }

    private constructor(
        private readonly tearDownFunction: () => Promise<unknown>,
        private readonly connectionStringFunction: () => string
    ) {}

    connectionString(): string {
        return this.connectionStringFunction();
    }

    async close(): Promise<void> {
        await this.tearDownFunction();
    }

    static isConfigurationSupportedInCurrentEnv(config: MongoClusterConfiguration): boolean {
        if (MongoDBClusterProcess.isSearchOptions(config) && process.env.GITHUB_ACTIONS === "true") {
            return process.platform === "linux";
        }

        return true;
    }

    private static isSearchOptions(opt: MongoClusterConfiguration): opt is MongoSearchConfiguration {
        return (opt as MongoSearchConfiguration)?.search === true;
    }

    private static isMongoRunnerOptions(opt: MongoClusterConfiguration): opt is MongoRunnerConfiguration {
        return (opt as MongoRunnerConfiguration)?.runner === true;
    }
}
