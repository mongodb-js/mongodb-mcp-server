import type { MongoClusterOptions } from "mongodb-runner";
import { MongoCluster } from "mongodb-runner";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs/promises";
import type { Document } from "mongodb";
import { MongoClient, ObjectId } from "mongodb";
import type { IntegrationTest } from "../../helpers.js";
import {
    getResponseContent,
    setupIntegrationTest,
    defaultTestConfig,
    defaultDriverOptions,
    getDataFromUntrustedContent,
} from "../../helpers.js";
import type { UserConfig, DriverOptions } from "../../../../src/common/config.js";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { EJSON } from "bson";
import { GenericContainer } from "testcontainers";
import type { StartedTestContainer } from "testcontainers";
import { ShellWaitStrategy } from "testcontainers/build/wait-strategies/shell-wait-strategy.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const testDataDumpPath = path.join(__dirname, "..", "..", "..", "accuracy", "test-data-dumps");

const testDataPaths = [
    {
        db: "comics",
        collection: "books",
        path: path.join(testDataDumpPath, "comics.books.json"),
    },
    {
        db: "comics",
        collection: "characters",
        path: path.join(testDataDumpPath, "comics.characters.json"),
    },
    {
        db: "mflix",
        collection: "movies",
        path: path.join(testDataDumpPath, "mflix.movies.json"),
    },
    {
        db: "mflix",
        collection: "shows",
        path: path.join(testDataDumpPath, "mflix.shows.json"),
    },
    {
        db: "support",
        collection: "tickets",
        path: path.join(testDataDumpPath, "support.tickets.json"),
    },
];

interface MongoDBIntegrationTest {
    mongoClient: () => MongoClient;
    connectionString: () => string;
    randomDbName: () => string;
}

export type MongoDBIntegrationTestCase = IntegrationTest &
    MongoDBIntegrationTest & { connectMcpClient: () => Promise<void> };

export type MongoSearchConfiguration = { search: true; image?: string };

export function describeWithMongoDB(
    name: string,
    fn: (integration: MongoDBIntegrationTestCase) => void,
    getUserConfig: (mdbIntegration: MongoDBIntegrationTest) => UserConfig = () => defaultTestConfig,
    getDriverOptions: (mdbIntegration: MongoDBIntegrationTest) => DriverOptions = () => defaultDriverOptions,
    downloadOptions: MongoClusterOptions["downloadOptions"] | MongoSearchConfiguration = { enterprise: false },
    serverArgs: string[] = []
): void {
    describe.skipIf(!isMongoDBEnvSupported(downloadOptions))(name, () => {
        const mdbIntegration = setupMongoDBIntegrationTest(downloadOptions, serverArgs);
        const integration = setupIntegrationTest(
            () => ({
                ...getUserConfig(mdbIntegration),
            }),
            () => ({
                ...getDriverOptions(mdbIntegration),
            })
        );

        fn({
            ...integration,
            ...mdbIntegration,
            connectMcpClient: async () => {
                const { tools } = await integration.mcpClient().listTools();
                if (tools.find((tool) => tool.name === "connect")) {
                    await integration.mcpClient().callTool({
                        name: "connect",
                        arguments: { connectionString: mdbIntegration.connectionString() },
                    });
                }
            },
        });
    });
}

function isSearchOptions(
    opt: MongoClusterOptions["downloadOptions"] | MongoSearchConfiguration
): opt is MongoSearchConfiguration {
    return (opt as MongoSearchConfiguration)?.search === true;
}

function isTestContainersCluster(
    cluster: MongoCluster | StartedTestContainer | undefined
): cluster is StartedTestContainer {
    return !!(cluster as StartedTestContainer)?.stop;
}

function isMongoDBEnvSupported(
    downloadOptions: MongoClusterOptions["downloadOptions"] | MongoSearchConfiguration
): boolean {
    // on GHA, OSX does not support nested virtualisation and we don't release
    // windows containers, so for now we can only run these tests in Linux.
    if (isSearchOptions(downloadOptions) && process.env.GITHUB_ACTIONS === "true") {
        return process.platform === "linux";
    }

    return true;
}

export function setupMongoDBIntegrationTest(
    downloadOptions: MongoClusterOptions["downloadOptions"] | MongoSearchConfiguration,
    serverArgs: string[]
): MongoDBIntegrationTest {
    let mongoCluster: MongoCluster | StartedTestContainer | undefined;
    let mongoClient: MongoClient | undefined;
    let randomDbName: string;

    beforeEach(() => {
        randomDbName = new ObjectId().toString();
    });

    afterEach(async () => {
        await mongoClient?.close();
        mongoClient = undefined;
    });

    beforeAll(async function () {
        if (isSearchOptions(downloadOptions)) {
            mongoCluster = await new GenericContainer(downloadOptions.image ?? "mongodb/mongodb-atlas-local:8")
                .withExposedPorts(27017)
                .withCommand(["/usr/local/bin/runner", "server"])
                .withWaitStrategy(new ShellWaitStrategy(`mongosh --eval 'db.test.getSearchIndexes()'`))
                .start();
            return;
        }

        // Downloading Windows executables in CI takes a long time because
        // they include debug symbols...
        const tmpDir = path.join(__dirname, "..", "..", "..", "tmp");
        await fs.mkdir(tmpDir, { recursive: true });

        // On Windows, we may have a situation where mongod.exe is not fully released by the OS
        // before we attempt to run it again, so we add a retry.
        let dbsDir = path.join(tmpDir, "mongodb-runner", "dbs");
        for (let i = 0; i < 10; i++) {
            try {
                mongoCluster = await MongoCluster.start({
                    tmpDir: dbsDir,
                    logDir: path.join(tmpDir, "mongodb-runner", "logs"),
                    topology: "standalone",
                    version: downloadOptions?.version ?? "8.0.12",
                    downloadOptions,
                    args: serverArgs,
                });

                return;
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

        throw new Error("Failed to start cluster after 10 attempts");
    }, 120_000);

    afterAll(async function () {
        if (isTestContainersCluster(mongoCluster)) {
            await mongoCluster.stop();
        } else {
            await mongoCluster?.close();
        }
        mongoCluster = undefined;
    });

    const getConnectionString = (): string => {
        if (!mongoCluster) {
            throw new Error("beforeAll() hook not ran yet");
        }

        if (isTestContainersCluster(mongoCluster)) {
            const mappedPort = mongoCluster.getMappedPort(27017);
            return `mongodb://${mongoCluster.getHost()}:${mappedPort}`;
        }

        return mongoCluster.connectionString;
    };

    return {
        mongoClient: (): MongoClient => {
            if (!mongoClient) {
                mongoClient = new MongoClient(getConnectionString());
            }
            return mongoClient;
        },
        connectionString: getConnectionString,

        randomDbName: () => randomDbName,
    };
}

export function validateAutoConnectBehavior(
    integration: IntegrationTest & MongoDBIntegrationTest,
    name: string,
    validation: () => {
        args: { [x: string]: unknown };
        expectedResponse?: string;
        validate?: (content: unknown) => void;
    },
    beforeEachImpl?: () => Promise<void>
): void {
    describe("when not connected", () => {
        if (beforeEachImpl) {
            beforeEach(() => beforeEachImpl());
        }

        afterEach(() => {
            integration.mcpServer().userConfig.connectionString = undefined;
        });

        it("connects automatically if connection string is configured", async () => {
            integration.mcpServer().userConfig.connectionString = integration.connectionString();

            const validationInfo = validation();

            const response = await integration.mcpClient().callTool({
                name,
                arguments: validationInfo.args,
            });

            if (validationInfo.expectedResponse) {
                const content = getResponseContent(response.content);
                expect(content).toContain(validationInfo.expectedResponse);
            }

            if (validationInfo.validate) {
                validationInfo.validate(response.content);
            }
        });

        it("throws an error if connection string is not configured", async () => {
            const response = await integration.mcpClient().callTool({
                name,
                arguments: validation().args,
            });
            const content = getResponseContent(response.content);
            expect(content).toContain("You need to connect to a MongoDB instance before you can access its data.");
        });
    });
}

export function prepareTestData(integration: MongoDBIntegrationTest): {
    populateTestData: (this: void) => Promise<void>;
    cleanupTestDatabases: (this: void) => Promise<void>;
} {
    const NON_TEST_DBS = ["admin", "config", "local"];
    const testData: {
        db: string;
        collection: string;
        data: Document[];
    }[] = [];

    beforeAll(async () => {
        for (const { db, collection, path } of testDataPaths) {
            testData.push({
                db,
                collection,
                data: JSON.parse(await fs.readFile(path, "utf8")) as Document[],
            });
        }
    });

    return {
        async populateTestData(this: void): Promise<void> {
            const client = integration.mongoClient();
            for (const { db, collection, data } of testData) {
                await client.db(db).collection(collection).insertMany(data);
            }
        },
        async cleanupTestDatabases(this: void): Promise<void> {
            const client = integration.mongoClient();
            const admin = client.db().admin();
            const databases = await admin.listDatabases();
            await Promise.all(
                databases.databases
                    .filter(({ name }) => !NON_TEST_DBS.includes(name))
                    .map(({ name }) => client.db(name).dropDatabase())
            );
        },
    };
}

export function getSingleDocFromUntrustedContent<T = unknown>(content: string): T {
    const data = getDataFromUntrustedContent(content);
    return EJSON.parse(data, { relaxed: true }) as T;
}

export function getDocsFromUntrustedContent<T = unknown>(content: string): T[] {
    const data = getDataFromUntrustedContent(content);
    return EJSON.parse(data, { relaxed: true }) as T[];
}

export async function isCommunityServer(integration: MongoDBIntegrationTestCase): Promise<boolean> {
    const client = integration.mongoClient();
    const buildInfo = await client.db("_").command({ buildInfo: 1 });
    const modules: string[] = buildInfo.modules as string[];

    return !modules.includes("enterprise");
}

export async function getServerVersion(integration: MongoDBIntegrationTestCase): Promise<string> {
    const client = integration.mongoClient();
    const serverStatus = await client.db("admin").admin().serverStatus();
    return serverStatus.version as string;
}
