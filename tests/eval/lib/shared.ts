import { MongoClient } from "mongodb";
import { InMemoryMcpConnection, type McpClient } from "./mcp.js";
import { dropTempDb } from "./seeding.js";
import { createOpenAI, type OpenAIProvider } from "@ai-sdk/openai";

let braintrustGatewayFactory: AsyncSingleton<OpenAIProvider> | null = null;
let mcpClientFactory: AsyncSingleton<McpClient> | null = null;
let mongoClientFactory: AsyncSingleton<MongoClient> | null = null;
const tempDbRegistry = new Set<string>();

/**
 * A helper class to create a singleton instance of a promise.
 * In case of failure, the instance is cleared and the next call will retry.
 *
 * @template T - The type of the instance.
 * @param factory - The factory function to create the instance.
 * @returns The singleton instance.
 */
class AsyncSingleton<T> {
    #instance: Promise<T> | null = null;

    constructor(private readonly factory: () => Promise<T>) {}

    singletonInstance(): Promise<T> {
        if (!this.#instance) {
            this.#instance = this.factory().catch((e) => {
                this.#instance = null;
                throw e;
            });
        }
        return this.#instance;
    }
}

export async function getAiProvider(): Promise<OpenAIProvider> {
    if (!braintrustGatewayFactory) {
        // eslint-disable-next-line @typescript-eslint/require-await
        braintrustGatewayFactory = new AsyncSingleton(async () => {
            const apiKey = process.env.BRAINTRUST_API_KEY_OVERRIDE ?? process.env.BRAINTRUST_API_KEY;
            if (!apiKey) {
                throw new Error("BRAINTRUST_API_KEY is required to run the eval.");
            }

            const defaultBaseURL = "https://gateway.braintrust.dev";
            const baseURL = process.env.OPENAI_BASE_URL ?? defaultBaseURL;

            return createOpenAI({ baseURL, apiKey });
        });
    }
    return braintrustGatewayFactory.singletonInstance();
}
/**
 * Gets the singleton in-memory MCP client instance.
 *
 * @param connectionString - The MongoDB connection string.
 * @returns The MCP client.
 */
export async function getMcpClient(connectionString: string): Promise<McpClient> {
    if (!mcpClientFactory) {
        mcpClientFactory = new AsyncSingleton(() => InMemoryMcpConnection.create(connectionString));
    }
    return mcpClientFactory.singletonInstance();
}

/**
 * Gets the singleton MongoDB client instance.
 *
 * @param connectionString - The MongoDB connection string.
 * @returns The MongoDB client.
 */
export function getMongoDbClient(connectionString: string): Promise<MongoClient> {
    if (!mongoClientFactory) {
        mongoClientFactory = new AsyncSingleton(() => new MongoClient(connectionString).connect());
    }
    return mongoClientFactory.singletonInstance();
}

/**
 * Registers a temporary database name.
 * To double-check and ensure that it'll be dropped after the Eval completes if not deleted at the end of the task.
 *
 * @param name - The name of the temporary database.
 */
export function registerTempDb(name: string): void {
    tempDbRegistry.add(name);
}

/**
 * Drops a temporary database.
 *
 * @param name - The name of the temporary database.
 */
export async function dropCaseDb(name: string): Promise<void> {
    if (!tempDbRegistry.has(name)) return;
    try {
        if (!mongoClientFactory) {
            throw new Error("MongoDB client not initialized");
        }
        const client = await mongoClientFactory.singletonInstance();
        await dropTempDb(client, name);
    } catch (error) {
        console.error(`Failed to drop temp database '${name}':`, error);
    } finally {
        tempDbRegistry.delete(name);
    }
}

/**
 * Teardown all shared resources including
 * the temporary databases, the MongoDB client, and the MCP client.
 * This will run when the Eval completes.
 */
export async function teardown(): Promise<void> {
    if (mcpClientFactory) {
        const mcpClient = await mcpClientFactory.singletonInstance();
        await mcpClient.close();
    }

    if (mongoClientFactory) {
        const client = await mongoClientFactory.singletonInstance();
        for (const db of tempDbRegistry) {
            try {
                await dropTempDb(client, db);
            } catch (error) {
                console.error(`Failed to drop temp database '${db}':`, error);
            }
        }
        tempDbRegistry.clear();
        await client.close();
    }

    mongoClientFactory = null;
    mcpClientFactory = null;
}
