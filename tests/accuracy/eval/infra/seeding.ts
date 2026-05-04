import fs from "fs/promises";
import path from "path";
import type { MongoClient, Document, SearchIndexDescription, CreateIndexesOptions, IndexSpecification } from "mongodb";

export type SeedIndexSpec =
    | ({
          type: "classic";
          spec: IndexSpecification;
      } & CreateIndexesOptions)
    | ({
          type: "search" | "vectorSearch";
      } & SearchIndexDescription);

export interface SeedCollectionData {
    collection: string;
    documents: string;
    indexes?: SeedIndexSpec[];
}

// listSearchIndexes only queries the catalog and succeeds even when mongot isn't running.
// createSearchIndexes actually exercises the mongot connection, so it's the right probe here.
async function waitForSearchService(client: MongoClient, timeoutMs = 20_000, intervalMs = 500): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    const probeDb = client.db("__eval_probe");
    const probeColl = probeDb.collection("__probe");

    while (Date.now() < deadline) {
        try {
            await probeColl.insertOne({ _probe: 1 });
            await probeColl.createSearchIndexes([{ definition: { mappings: { dynamic: true } } }]);
            return;
        } catch {
            await new Promise((r) => setTimeout(r, intervalMs));
        } finally {
            await probeColl.drop().catch(() => {});
            await probeDb.dropDatabase().catch(() => {});
        }
    }
    throw new Error(`Search Index Management service not ready after ${timeoutMs}ms`);
}

export async function seedCollections(client: MongoClient, db: string, collections: SeedCollectionData[]): Promise<void> {
    if (collections.some((c) => c.indexes?.some((s) => s.type === "search" || s.type === "vectorSearch"))) {
        await waitForSearchService(client);
    }

    for (const { collection, documents, indexes } of collections) {
        const coll = client.db(db).collection(collection);
        const resolvedPath = path.resolve(documents);
        const docs = JSON.parse(await fs.readFile(resolvedPath, "utf8")) as Document[];
        await coll.insertMany(docs);

        for (const index of indexes ?? []) {
            switch (index.type) {
                case "classic": {
                    // eslint-disable-next-line @typescript-eslint/no-unused-vars
                    const { type, spec, ...options } = index;
                    await coll.createIndex(spec, options);
                    break;
                }
                case "search":
                case "vectorSearch":
                    await coll.createSearchIndex(index);
                    break;
            }
        }
    }
}
