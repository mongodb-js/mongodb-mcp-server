import fs from "fs/promises";
import { createWriteStream, type WriteStream } from "fs";
import path from "path";
import type { MongoClusterOptions } from "mongodb-runner";
import { GenericContainer } from "testcontainers";
import { MongoCluster } from "mongodb-runner";
import { ShellWaitStrategy } from "testcontainers/build/wait-strategies/shell-wait-strategy.js";

// Debug logging for container issues
const CONTAINER_LOG_PATH = path.join(process.cwd(), "container-debug.log");
const IS_CI = process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true";
let containerLogStream: WriteStream | null = null;

interface ContainerLogger {
    write: (msg: string) => void;
}

function getContainerLogger(): ContainerLogger {
    if (!containerLogStream) {
        containerLogStream = createWriteStream(CONTAINER_LOG_PATH, { flags: "a" });
        containerLogStream.write(`\n\n=== Container started at ${new Date().toISOString()} ===\n`);
        if (IS_CI) {
            process.stderr.write(`[CONTAINER-DEBUG] Logs also written to: ${CONTAINER_LOG_PATH}\n`);
        } else {
            console.log(`[DEBUG] Container logs will be written to: ${CONTAINER_LOG_PATH}`);
        }
    }

    return {
        write: (msg: string) => {
            containerLogStream?.write(msg);
            // In CI, also write to stderr so it shows in GitHub Actions logs
            if (IS_CI) {
                process.stderr.write(`[CONTAINER] ${msg}`);
            }
        },
    };
}

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
            const imageName = config.image ?? DEFAULT_LOCAL_IMAGE;
            const logger = getContainerLogger();
            logger.write(`[${new Date().toISOString()}] Starting container with image: ${imageName}\n`);

            const runningContainer = await new GenericContainer(imageName)
                .withExposedPorts(27017)
                .withCommand(["/usr/local/bin/runner", "server"])
                .withLogConsumer((stream) => {
                    stream.on("data", (line) => {
                        const timestamp = new Date().toISOString();
                        logger.write(`[${timestamp}] ${line}`);
                    });
                    stream.on("end", () => {
                        logger.write(`[${new Date().toISOString()}] === Container stream ended ===\n`);
                    });
                    stream.on("error", (err) => {
                        logger.write(`[${new Date().toISOString()}] === Container stream error: ${err} ===\n`);
                    });
                })
                .withWaitStrategy(new ShellWaitStrategy(`mongosh --eval 'db.adminCommand({ping: 1}) && db.test.getSearchIndexes()'`))
                .start();

            logger.write(`[${new Date().toISOString()}] Container started successfully, ID: ${runningContainer.getId()}\n`);

            return new MongoDBClusterProcess(
                async () => {
                    logger.write(`[${new Date().toISOString()}] === Intentionally stopping container ===\n`);
                    await runningContainer.stop();
                    logger.write(`[${new Date().toISOString()}] === Container stopped ===\n`);
                },
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
