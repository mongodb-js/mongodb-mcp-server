import path from "path";
import { fileURLToPath } from "url";
import fs from "fs/promises";
import type { Collection, Document } from "mongodb";
import { MongoClient, ObjectId } from "mongodb";
import type { IntegrationTest } from "../../helpers.js";
import {
    getResponseContent,
    setupIntegrationTest,
    defaultTestConfig,
    getDataFromUntrustedContent,
} from "../../helpers.js";
import type { UserConfig } from "../../../../src/common/config/userConfig.js";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { EJSON } from "bson";
import { MongoDBClusterProcess } from "./mongodbClusterProcess.js";
import type { MongoClusterConfiguration } from "./mongodbClusterProcess.js";
import type { createMockElicitInput, MockClientCapabilities } from "../../../utils/elicitationMocks.js";

export const DEFAULT_WAIT_TIMEOUT = 1000;
export const DEFAULT_RETRY_INTERVAL = 100;

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

const DEFAULT_MONGODB_PROCESS_OPTIONS: MongoClusterConfiguration = {
    runner: true,
    downloadOptions: { enterprise: false },
    serverArgs: [],
};

interface MongoDBIntegrationTest {
    mongoClient: () => MongoClient;
    connectionString: () => string;
    randomDbName: () => string;
}

export type MongoDBIntegrationTestCase = IntegrationTest &
    MongoDBIntegrationTest & { connectMcpClient: () => Promise<void> };

export type MongoSearchConfiguration = { search: true; image?: string };

export type TestSuiteConfig = {
    getUserConfig: (mdbIntegration: MongoDBIntegrationTest) => UserConfig;
    downloadOptions: MongoClusterConfiguration;
    getMockElicitationInput?: () => ReturnType<typeof createMockElicitInput>;
    getClientCapabilities?: () => MockClientCapabilities;
};

export const defaultTestSuiteConfig: TestSuiteConfig = {
    getUserConfig: () => defaultTestConfig,
    downloadOptions: DEFAULT_MONGODB_PROCESS_OPTIONS,
};

export function describeWithMongoDB(
    name: string,
    fn: (integration: MongoDBIntegrationTestCase) => void,
    partialTestSuiteConfig?: Partial<TestSuiteConfig>
): void {
    const { getUserConfig, downloadOptions, getMockElicitationInput, getClientCapabilities } = {
        ...defaultTestSuiteConfig,
        ...partialTestSuiteConfig,
    };
    describe.skipIf(!MongoDBClusterProcess.isConfigurationSupportedInCurrentEnv(downloadOptions))(name, () => {
        const mdbIntegration = setupMongoDBIntegrationTest(downloadOptions);
        const mockElicitInput = getMockElicitationInput?.();
        const integration = setupIntegrationTest(
            () => ({
                ...getUserConfig(mdbIntegration),
            }),
            { elicitInput: mockElicitInput, getClientCapabilities }
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

export function setupMongoDBIntegrationTest(
    configuration: MongoClusterConfiguration = DEFAULT_MONGODB_PROCESS_OPTIONS
): MongoDBIntegrationTest {
    let mongoCluster: MongoDBClusterProcess | undefined;
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
        mongoCluster = await MongoDBClusterProcess.spinUp(configuration);
    }, 120_000);

    afterAll(async function () {
        await mongoCluster?.close();
        mongoCluster = undefined;
    });

    const getConnectionString = (): string => {
        if (!mongoCluster) {
            throw new Error("beforeAll() hook not ran yet");
        }

        return mongoCluster.connectionString();
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
export const SEARCH_WAIT_TIMEOUT = 20_000;

export async function waitUntilSearchIsReady(
    mongoClient: MongoClient,
    timeout: number = SEARCH_WAIT_TIMEOUT,
    interval: number = DEFAULT_RETRY_INTERVAL
): Promise<void> {
    await vi.waitFor(
        async () => {
            const testCollection = mongoClient.db("tempDB").collection("tempCollection");
            await testCollection.insertOne({ field1: "yay" });
            await testCollection.createSearchIndexes([{ definition: { mappings: { dynamic: true } } }]);
            await testCollection.drop();
        },
        { timeout, interval }
    );
}

async function waitUntilSearchIndexIs(
    collection: Collection,
    searchIndex: string,
    indexValidator: (index: { name: string; status: string; queryable: boolean }) => boolean,
    timeout: number,
    interval: number,
    getValidationFailedMessage: (searchIndexes: Document[]) => string = () => "Search index did not pass validation"
): Promise<void> {
    await vi.waitFor(
        async () => {
            const searchIndexes = (await collection.listSearchIndexes(searchIndex).toArray()) as {
                name: string;
                status: string;
                queryable: boolean;
            }[];

            if (!searchIndexes.some((index) => indexValidator(index))) {
                throw new Error(getValidationFailedMessage(searchIndexes));
            }
        },
        {
            timeout,
            interval,
        }
    );
}

export async function waitUntilSearchIndexIsListed(
    collection: Collection,
    searchIndex: string,
    timeout: number = SEARCH_WAIT_TIMEOUT,
    interval: number = DEFAULT_RETRY_INTERVAL
): Promise<void> {
    return waitUntilSearchIndexIs(
        collection,
        searchIndex,
        (index) => index.name === searchIndex,
        timeout,
        interval,
        (searchIndexes) =>
            `Index ${searchIndex} is not yet in the index list (${searchIndexes.map(({ name }) => String(name)).join(", ")})`
    );
}

export async function waitUntilSearchIndexIsQueryable(
    collection: Collection,
    searchIndex: string,
    timeout: number = SEARCH_WAIT_TIMEOUT,
    interval: number = DEFAULT_RETRY_INTERVAL
): Promise<void> {
    return waitUntilSearchIndexIs(
        collection,
        searchIndex,
        (index) => index.name === searchIndex && index.status === "READY",
        timeout,
        interval,
        (searchIndexes) => {
            const index = searchIndexes.find((index) => index.name === searchIndex);
            return `Index ${searchIndex} in ${collection.dbName}.${collection.collectionName} is not ready. Last known status - ${JSON.stringify(index)}`;
        }
    );
}

export async function createVectorSearchIndexAndWait(
    mongoClient: MongoClient,
    database: string,
    collection: string,
    fields: Document[]
): Promise<void> {
    const coll = await mongoClient.db(database).createCollection(collection);
    await coll.createSearchIndex({
        name: "default",
        type: "vectorSearch",
        definition: {
            fields,
        },
    });

    await waitUntilSearchIndexIsQueryable(coll, "default");
}
