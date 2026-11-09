import { describe, expect, it } from "vitest";
import { CollectionIndexesTool } from "./collectionIndexes.js";

class TestCollectionIndexesTool extends CollectionIndexesTool {
    public extractSearchIndexDetails(
        indexes: Record<string, unknown>[]
    ): ReturnType<CollectionIndexesTool["extractSearchIndexDetails"]> {
        return super.extractSearchIndexDetails(indexes);
    }
}

// extractSearchIndexDetails is pure (no instance state), so a prototype-only
// instance is enough to exercise it without constructing the tool server.
const tool = Object.create(TestCollectionIndexesTool.prototype) as TestCollectionIndexesTool;

describe("extractSearchIndexDetails", () => {
    it("classifies an index with an autoEmbed field as autoEmbed even when the server reports vectorSearch", () => {
        const [index] = tool.extractSearchIndexDetails([
            {
                name: "my-auto-embed-index",
                type: "vectorSearch",
                status: "READY",
                queryable: true,
                latestDefinition: {
                    fields: [{ type: "autoEmbed", path: "plot", model: "voyage-4-large", modality: "text" }],
                },
            },
        ]);
        expect(index).toEqual({
            name: "my-auto-embed-index",
            type: "autoEmbed",
            status: "READY",
            queryable: true,
            latestDefinition: {
                fields: [{ type: "autoEmbed", path: "plot", model: "voyage-4-large", modality: "text" }],
            },
        });
    });

    it("classifies an autoEmbed index without a server-provided type", () => {
        const [index] = tool.extractSearchIndexDetails([
            {
                name: "my-auto-embed-index",
                status: "READY",
                queryable: true,
                latestDefinition: {
                    fields: [{ type: "autoEmbed", path: "plot", model: "voyage-4-large", modality: "text" }],
                },
            },
        ]);
        expect(index?.type).toBe("autoEmbed");
    });

    it("keeps the server-provided type for regular vector search indexes", () => {
        const [index] = tool.extractSearchIndexDetails([
            {
                name: "my-mixed-index",
                type: "vectorSearch",
                status: "READY",
                queryable: true,
                latestDefinition: {
                    fields: [
                        { type: "vector", path: "field1_embeddings", numDimensions: 4, similarity: "euclidean" },
                        { type: "filter", path: "age" },
                    ],
                },
            },
        ]);
        expect(index?.type).toBe("vectorSearch");
    });

    it("infers vectorSearch from a fields definition when the server provides no type", () => {
        const [index] = tool.extractSearchIndexDetails([
            {
                name: "my-mixed-index",
                status: "READY",
                queryable: true,
                latestDefinition: {
                    fields: [{ type: "vector", path: "field1_embeddings", numDimensions: 4, similarity: "euclidean" }],
                },
            },
        ]);
        expect(index?.type).toBe("vectorSearch");
    });

    it("classifies a mappings-based index as search", () => {
        const [index] = tool.extractSearchIndexDetails([
            {
                name: "default",
                type: "search",
                status: "READY",
                queryable: true,
                latestDefinition: { mappings: { dynamic: true, fields: {} } },
            },
        ]);
        expect(index?.type).toBe("search");
    });

    it("falls back to UNKNOWN for an unrecognizable definition", () => {
        const [index] = tool.extractSearchIndexDetails([{ name: "weird-index" }]);
        expect(index?.type).toBe("UNKNOWN");
        expect(index?.name).toBe("weird-index");
        expect(index?.status).toBe("UNKNOWN");
        expect(index?.queryable).toBe(false);
        expect(index?.latestDefinition).toEqual({});
    });
});
