import fs from "fs/promises";
import path from "path";
import type { MongoClusterOptions } from "mongodb-runner";
import { GenericContainer } from "testcontainers";
import { MongoCluster } from "mongodb-runner";
import { ShellWaitStrategy } from "testcontainers/build/wait-strategies/shell-wait-strategy.js";

export type MongoRunnerConfiguration = {
    runner: true;
    downloadOptions: MongoClusterOptions["downloadOptions"];
    serverArgs: string[];
};

export type MongoSearchConfiguration = { search: true; image?: string };
export type MongoClusterConfiguration = MongoRunnerConfiguration | MongoSearchConfiguration;

const DOWNLOAD_RETRIES = 10;

const DEFAULT_LOCAL_IMAGE = "mongodb/mongodb-atlas-local:8";
export class MongoDBClusterProcess {
    static async spinUp(config: MongoClusterConfiguration): Promise<MongoDBClusterProcess> {
        if (MongoDBClusterProcess.isSearchOptions(config)) {
            const runningContainer = await new GenericContainer(config.image ?? DEFAULT_LOCAL_IMAGE)
                .withExposedPorts(27017)
                .withCommand(["/usr/local/bin/runner", "server"])
                .withWaitStrategy(new ShellWaitStrategy(`mongosh --eval 'db.test.getSearchIndexes()'`))
                .start();

            return new MongoDBClusterProcess(
                () => runningContainer.stop(),
                () =>
                    `mongodb://${runningContainer.getHost()}:${runningContainer.getMappedPort(27017)}/?directConnection=true`
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
