import { MongoClient } from "mongodb";
import { InMemoryMcpFactory, type McpClient } from "./mcp.js";
import { dropTempDb } from "./seeding.js";

let mcpFactory: InMemoryMcpFactory | null = null;
let mongoDbClient: MongoClient | null = null;
const tempDbRegistry = new Set<string>();

/**
 * Gets the singleton in-memory MCP client instance.
 *
 * @param connectionString - The MongoDB connection string.
 * @returns The MCP client.
 */
export async function getMcpClient(connectionString: string): Promise<McpClient> {
    if (!mcpFactory) {
        mcpFactory = new InMemoryMcpFactory(connectionString);
    }
    return mcpFactory.singletonInstance();
}

/**
 * Gets the singleton MongoDB client instance.
 *
 * @param connectionString - The MongoDB connection string.
 * @returns The MongoDB client.
 */
export async function getMongoDbClient(connectionString: string): Promise<MongoClient> {
    if (!mongoDbClient) {
        mongoDbClient = new MongoClient(connectionString);
        await mongoDbClient.connect();
    }
    return mongoDbClient;
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
        if (!mongoDbClient) {
            throw new Error("MongoDB client not initialized");
        }
        await dropTempDb(mongoDbClient, name);
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
    if (mongoDbClient) {
        for (const db of tempDbRegistry) {
            try {
                await dropTempDb(mongoDbClient, db);
            } catch (error) {
                console.error(`Failed to drop temp database '${db}':`, error);
            }
        }
    }
    tempDbRegistry.clear();

    await Promise.allSettled([mongoDbClient?.close(), mcpFactory?.close()]);
    mongoDbClient = null;
    mcpFactory = null;
}
