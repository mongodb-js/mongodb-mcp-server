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

const resolveType = (index: Record<string, unknown>): string | undefined => extractTypes([index])[0]?.type;

const vectorFields = [{ type: "vector", path: "embedding", numDimensions: 4, similarity: "euclidean" }];

describe("CollectionIndexesTool search index type resolution", () => {
    describe("search index types", () => {
        it("keeps the server-provided type for regular vector indexes", () => {
            expect(resolveType({ name: "vec", type: "vectorSearch", latestDefinition: { fields: vectorFields } })).toBe(
                "vectorSearch"
            );
        });

        it("keeps the server-provided type even when the definition has a fields array", () => {
            expect(resolveType({ name: "x", type: "search", latestDefinition: { fields: vectorFields } })).toBe(
                "search"
            );
        });

        it("uses an explicit definition type before assuming vectorSearch from fields", () => {
            expect(resolveType({ name: "x", latestDefinition: { type: "search", fields: vectorFields } })).toBe(
                "search"
            );
        });

        it("infers vectorSearch from fields when the server provides no type", () => {
            expect(resolveType({ name: "vec", latestDefinition: { fields: vectorFields } })).toBe("vectorSearch");
        });

        it("infers vectorSearch for a vector index with only filter fields when the server provides no type", () => {
            expect(resolveType({ name: "vec", latestDefinition: { fields: [{ type: "filter", path: "age" }] } })).toBe(
                "vectorSearch"
            );
        });

        it("keeps the server-provided type for lexical search indexes", () => {
            expect(
                resolveType({ name: "lex", type: "search", latestDefinition: { mappings: { dynamic: true } } })
            ).toBe("search");
        });

        it("infers search from mappings when the server provides no type", () => {
            expect(resolveType({ name: "lex", latestDefinition: { mappings: { dynamic: true } } })).toBe("search");
        });

        it("treats an autoEmbed definition as vectorSearch", () => {
            expect(
                resolveType({
                    name: "auto",
                    latestDefinition: { fields: [{ type: "autoEmbed", path: "plot", model: "voyage-4-large" }] },
                })
            ).toBe("vectorSearch");
        });

        it("returns UNKNOWN for an unrecognizable definition", () => {
            expect(resolveType({ name: "empty" })).toBe("UNKNOWN");
        });
    });
});
