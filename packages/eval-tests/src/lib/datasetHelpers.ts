import type { Document } from "mongodb";
import type { DbSeedEntry, SeedIndexSpec } from "./datasetTypes.js";
import movies from "../dbSeed/mflix.movies.json" with { type: "json" };
import moviesWithPlotEmbedding from "../dbSeed/mflix.movies-with-plot-embedding.json" with { type: "json" };
import synonyms from "../dbSeed/mflix.synonyms.json" with { type: "json" };
import { EJSON } from "bson";

// ╭──────────────────────────────────────────────╮
// │   ↘️ Seeding Documents                       │
// ╰──────────────────────────────────────────────╯

const SEED_DOCUMENTS: Record<string, Document[]> = {
    movies: EJSON.deserialize(movies) as Document[],
    "movies-with-plot-embedding": EJSON.deserialize(moviesWithPlotEmbedding) as Document[],
    synonyms: EJSON.deserialize(synonyms) as Document[],
};

/**
 * Get the seed documents for a collection.
 * @param collection - The collection name.
 * @returns The seed documents.
 */
export function getSeedDocuments(collection: string): Document[] {
    const docs = SEED_DOCUMENTS[collection];
    if (!docs) {
        throw new Error(
            `No seed data bundled for collection '${collection}'. Register it in seeding.ts and add dbSeed/<file>.json.`
        );
    }
    return docs;
}

// ╭──────────────────────────────────────────────╮
// │   ↘️ Dataset Helpers                         │
// ╰──────────────────────────────────────────────╯

export type ParsedSeed = { collection: string; indexes: SeedIndexSpec[] };

/**
 * Parse a seed entry into a collection name and indexes.
 * @param entry - The seed entry.
 * @returns The parsed seed.
 */
export function parseSeedEntry(entry: DbSeedEntry): ParsedSeed {
    if (typeof entry === "string") {
        return { collection: entry, indexes: [] };
    }

    const keys = Object.keys(entry);
    if (keys.length !== 1) {
        throw new Error(`Invalid db_seed entry, expected a single collection key but got: ${JSON.stringify(entry)}`);
    }

    const collection = keys[0];
    if (!collection) {
        throw new Error(`Invalid db_seed entry, expected a single collection key but got: ${JSON.stringify(entry)}`);
    }
    return { collection, indexes: entry[collection]?.indexes ?? [] };
}
