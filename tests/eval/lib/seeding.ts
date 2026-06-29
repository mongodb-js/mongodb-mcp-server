import type { MongoClient } from "mongodb";
import type { DbSeedEntry, SeedClassicIndex } from "./datasetTypes.js";
import { getSeedDocuments, parseSeedEntry } from "./datasetHelpers.js";
import { sleep } from "../../../src/common/managedTimeout.js";

// ╭──────────────────────────────────────────────╮
// │   ↘️ Seeding Constants                       │
// ╰──────────────────────────────────────────────╯

const DEFAULT_INDEX_READY_TIMEOUT_MS = 120_000;
const DEFAULT_INDEX_READY_INTERVAL_MS = 1_000;

/**
 * Wait for the indexes to be queryable.
 * If the indexes are not queryable after the timeout, an error is thrown.
 *
 * @param client - The MongoDB client.
 * @param db - The database name.
 * @param collection - The collection name.
 * @param indexNames - The names of the indexes to wait for.
 * @param timeoutMs - The timeout in milliseconds to wait for the indexes to be queryable.
 * @param intervalMs - The interval in milliseconds to check the indexes.
 */
async function waitForIndexesQueryable(
    client: MongoClient,
    db: string,
    collection: string,
    indexNames: string[],
    timeoutMs = DEFAULT_INDEX_READY_TIMEOUT_MS,
    intervalMs = DEFAULT_INDEX_READY_INTERVAL_MS
): Promise<void> {
    if (indexNames.length === 0) return;

    const coll = client.db(db).collection(collection);
    const deadline = Date.now() + timeoutMs;
    const pending = new Set(indexNames);

    while (Date.now() < deadline) {
        const existing = (await coll.listSearchIndexes().toArray()) as Array<{
            name?: string;
            status?: string;
            queryable?: boolean;
        }>;

        for (const idx of existing) {
            if (idx.name && pending.has(idx.name) && (idx.queryable === true || idx.status === "READY")) {
                pending.delete(idx.name);
            }
        }

        if (pending.size === 0) {
            return;
        }

        await sleep(intervalMs);
    }

    throw new Error(
        `Search index(es) [${[...pending].join(", ")}] on ${db}.${collection} not queryable after ${timeoutMs}ms`
    );
}

/**
 * Seed the temporary database with the given database seed.
 *
 * @param client - The MongoDB client.
 * @param db - The database name.
 * @param dbSeed - The database seed.
 */
export async function seedTempDb(dbClient: MongoClient, db: string, dbSeed: DbSeedEntry[] = []): Promise<void> {
    for (const entry of dbSeed) {
        const { collection, indexes } = parseSeedEntry(entry);
        const coll = dbClient.db(db).collection(collection);

        const docs = getSeedDocuments(collection);
        if (docs.length > 0) {
            await coll.insertMany(docs);
        }

        const searchIndexNames: string[] = [];
        for (const index of indexes) {
            if (index.type === "search" || index.type === "vectorSearch") {
                await coll.createSearchIndex({
                    name: index.name,
                    type: index.type,
                    definition: index.definition,
                });
                searchIndexNames.push(index.name);
            } else {
                const { key, name, type, ...options } = index as SeedClassicIndex;
                void type;
                await coll.createIndex(key, { name, ...options });
            }
        }

        await waitForIndexesQueryable(dbClient, db, collection, searchIndexNames);
    }
}

/**
 * Drop the temporary database.
 *
 * @param client - The MongoDB client.
 * @param db - The database name.
 */
export async function dropTempDb(client: MongoClient, db: string): Promise<void> {
    await client.db(db).dropDatabase();
}
