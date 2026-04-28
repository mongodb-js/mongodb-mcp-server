import fs from "fs/promises";
import path from "path";
import type { MongoClusterOptions, MongoDBUserDoc } from "mongodb-runner";
import { DockerComposeEnvironment, GenericContainer, Wait } from "testcontainers";
import { MongoCluster } from "mongodb-runner";
import { MongoClient } from "mongodb";
import { ConnectionString } from "mongodb-connection-string-url";
import { ShellWaitStrategy } from "testcontainers/build/wait-strategies/shell-wait-strategy.js";

export type MongoRunnerConfiguration = {
    runner: true;
    downloadOptions: MongoClusterOptions["downloadOptions"];
    serverArgs: string[];
    /**
     * Optional list of users to create on the spun-up cluster. When provided,
     * `--auth` is automatically added to the server arguments so the created
     * users' roles are actually enforced. The first user in the list is used
     * for the default (admin) connection string returned by
     * {@link MongoDBClusterProcess.connectionString}.
     */
    users?: MongoDBUserDoc[];
};

export type MongoSearchConfiguration = { search: true; image?: string };
export type MongoAutoEmbedSearchConfiguration = {
    autoEmbed: true;
    /**
     * The password to be used for creating a `searchCoordinator` role in
     * mongodb. Required for `mongot` instance to effectively communicate with
     * `mongod`.
     *
     * Expected to be provided through environment variable - `MDB_MONGOT_PASSWORD`
     */
    mongotPassword: string;

    /**
     * The voyage key to be used by `mongod` when auto-generating embeddings for
     * an aggregation.
     *
     * Expected to be provided through environment variable - `MDB_VOYAGE_API_KEY`
     *
     * Note: This can be same as `voyageIndexingKey` but to avoid getting rate
     * limited, it is advised to have these two as different keys.
     */
    voyageQueryKey: string;

    /**
     * The voyage key to be used by `mongod` when auto-generating embeddings at
     * the time of indexing.
     *
     * Expected to be provided through environment variable - `MDB_VOYAGE_API_KEY`
     *
     * Note: This can be same as `voyageQueryKey` but to avoid getting rate
     * limited, it is advised to have these two as different keys.
     */
    voyageIndexingKey: string;
};
export type MongoClusterConfiguration =
    | MongoRunnerConfiguration
    | MongoSearchConfiguration
    | MongoAutoEmbedSearchConfiguration;

const DOWNLOAD_RETRIES = 10;

// TODO: Revert this to generic tag 8, once the problem with atlas-local image
// is addressed.
const DEFAULT_LOCAL_IMAGE = "mongodb/mongodb-atlas-local:8.2.2-20251125T154829Z";
export class MongoDBClusterProcess {
    static async spinUp(config: MongoClusterConfiguration): Promise<MongoDBClusterProcess> {
        if (MongoDBClusterProcess.isSearchOption(config)) {
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
        } else if (MongoDBClusterProcess.isAutoEmbedSearchOption(config)) {
            const composeFilePath = path.join(__dirname, "mongot-community-setup");

            const environment = await new DockerComposeEnvironment(composeFilePath, "docker-compose.yml")
                .withEnvironment({
                    MONGOT_PASSWORD: config.mongotPassword,
                    VOYAGE_QUERY_KEY: config.voyageQueryKey,
                    VOYAGE_INDEXING_KEY: config.voyageIndexingKey,
                })
                .withWaitStrategy("mongod-1", Wait.forHealthCheck())
                .withWaitStrategy("mongot-1", Wait.forHealthCheck())
                .up();

            const mongodContainer = environment.getContainer("mongod-1");
            const mongodHost = mongodContainer.getHost();
            const mongodPort = mongodContainer.getMappedPort(27017);

            return new MongoDBClusterProcess(
                () => environment.down({ removeVolumes: true }),
                () => `mongodb://${mongodHost}:${mongodPort}/?directConnection=true`
            );
        } else if (MongoDBClusterProcess.isMongoRunnerOption(config)) {
            const { downloadOptions, serverArgs, users } = config;

            // When users are requested we need to start mongod with --auth so
            // their roles are actually enforced. Only the very first user is
            // passed to mongodb-runner, which creates it via the MongoDB
            // localhost exception. Any additional users are created via the
            // authenticated client below, because the localhost exception is
            // automatically disabled once the first user exists.
            const hasUsers = users && users.length > 0;
            const effectiveServerArgs =
                hasUsers && !serverArgs.includes("--auth") ? [...serverArgs, "--auth"] : serverArgs;
            const bootstrapUsers = hasUsers ? users.slice(0, 1) : undefined;
            const additionalUsers = hasUsers ? users.slice(1) : [];

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
                        args: effectiveServerArgs,
                        users: bootstrapUsers,
                    });

                    if (additionalUsers.length > 0) {
                        const client = new MongoClient(mongoCluster.connectionString);
                        try {
                            const admin = client.db("admin");
                            for (const user of additionalUsers) {
                                const { username, password, ...rest } = user;
                                await admin.command({
                                    createUser: username,
                                    pwd: password,
                                    ...rest,
                                });
                            }
                        } finally {
                            await client.close();
                        }
                    }

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

    /**
     * Build a connection string for a specific user/password against the same
     * cluster, optionally with a specific authSource and default database.
     * Preserves all query parameters from the original connection string
     * (e.g. directConnection, replicaSet).
     */
    connectionStringForUser({
        username,
        password,
        authSource,
        defaultDatabase,
    }: {
        username: string;
        password: string;
        authSource?: string;
        defaultDatabase?: string;
    }): string {
        const cs = new ConnectionString(this.connectionString());
        cs.username = username;
        cs.password = password;
        if (defaultDatabase !== undefined) {
            cs.pathname = `/${defaultDatabase}`;
        }
        if (authSource !== undefined) {
            cs.searchParams.set("authSource", authSource);
        }
        return cs.toString();
    }

    async close(): Promise<void> {
        await this.tearDownFunction();
    }

    static isConfigurationSupportedInCurrentEnv(config: MongoClusterConfiguration): boolean {
        if (MongoDBClusterProcess.isSearchOption(config) && process.env.GITHUB_ACTIONS === "true") {
            return process.platform === "linux";
        }

        if (MongoDBClusterProcess.isAutoEmbedSearchOption(config)) {
            const requiredKeys: (keyof MongoAutoEmbedSearchConfiguration)[] = [
                "mongotPassword",
                "voyageIndexingKey",
                "voyageQueryKey",
            ];

            const missingConfig = requiredKeys.filter((key) => !config[key]);

            // If the required config is missing there is nothing to do. So we
            // warn and exit early.
            if (missingConfig.length > 0) {
                console.warn(
                    `Auto-embeddings configuration not correctly configured, missing - ${missingConfig.join(", ")}. Will skip the test.`
                );
                return false;
            }

            // In GHA, only linux containers has docker runtime so we only run
            // on linux.
            if (process.env.GITHUB_ACTIONS === "true") {
                return process.platform === "linux";
            }

            // Very likely running locally so we assume there is a docker
            // runtime.
            return true;
        }

        return true;
    }

    private static isAutoEmbedSearchOption(opt: MongoClusterConfiguration): opt is MongoAutoEmbedSearchConfiguration {
        return (opt as MongoAutoEmbedSearchConfiguration)?.autoEmbed === true;
    }

    private static isSearchOption(opt: MongoClusterConfiguration): opt is MongoSearchConfiguration {
        return (opt as MongoSearchConfiguration)?.search === true;
    }

    private static isMongoRunnerOption(opt: MongoClusterConfiguration): opt is MongoRunnerConfiguration {
        return (opt as MongoRunnerConfiguration)?.runner === true;
    }
}
