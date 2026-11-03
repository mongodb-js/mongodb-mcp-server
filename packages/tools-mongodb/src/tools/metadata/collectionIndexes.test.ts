import { describe, expect, it } from "vitest";
import { CollectionIndexesTool } from "./collectionIndexes.js";

type SearchIndexDetails = { name: string; type: string };

// extractSearchIndexDetails is a pure mapping over the index documents, so we can call it
// without constructing the full tool (which needs a session and connection manager).
const extractTypes = (indexes: Record<string, unknown>[]): SearchIndexDetails[] => {
    const tool = Object.create(CollectionIndexesTool.prototype) as unknown as {
        extractSearchIndexDetails: (indexes: Record<string, unknown>[]) => SearchIndexDetails[];
    };
    return tool.extractSearchIndexDetails(indexes);
};

const autoEmbedFields = [{ type: "autoEmbed", path: "plot", model: "voyage-4-large", modality: "text" }];

describe("CollectionIndexesTool search index type resolution", () => {
    it("reports autoEmbed when the server returns no top-level type", () => {
        const [index] = extractTypes([{ name: "auto", latestDefinition: { fields: autoEmbedFields } }]);
        expect(index?.type).toBe("autoEmbed");
    });

    it("reports autoEmbed even when the server reports the index as vectorSearch", () => {
        const [index] = extractTypes([
            { name: "auto", type: "vectorSearch", latestDefinition: { fields: autoEmbedFields } },
        ]);
        expect(index?.type).toBe("autoEmbed");
    });

    it("reports autoEmbed for a mixed autoEmbed and filter definition", () => {
        const [index] = extractTypes([
            {
                name: "auto",
                type: "vectorSearch",
                latestDefinition: { fields: [...autoEmbedFields, { type: "filter", path: "age" }] },
            },
        ]);
        expect(index?.type).toBe("autoEmbed");
    });

    it("keeps the server-provided type for regular vector indexes", () => {
        const [index] = extractTypes([
            {
                name: "vec",
                type: "vectorSearch",
                latestDefinition: { fields: [{ type: "vector", path: "embedding" }] },
            },
        ]);
        expect(index?.type).toBe("vectorSearch");
    });

    it("falls back to the definition when the server has no type", () => {
        const result = extractTypes([
            { name: "vec", latestDefinition: { fields: [{ type: "vector", path: "embedding" }] } },
            { name: "lexical", latestDefinition: { mappings: { dynamic: true } } },
            { name: "explicit", latestDefinition: { type: "search" } },
            { name: "empty" },
        ]);
        expect(result.map((r) => r.type)).toEqual(["vectorSearch", "search", "search", "UNKNOWN"]);
    });
});
