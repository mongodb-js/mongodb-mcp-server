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

const autoEmbedFields = [{ type: "autoEmbed", path: "plot", model: "voyage-4-large", modality: "text" }];
const vectorFields = [{ type: "vector", path: "embedding", numDimensions: 4, similarity: "euclidean" }];

describe("CollectionIndexesTool search index type resolution", () => {
    describe("auto-embed indexes", () => {
        it("reports autoEmbed when the server returns no top-level type", () => {
            expect(resolveType({ name: "auto", latestDefinition: { fields: autoEmbedFields } })).toBe("autoEmbed");
        });

        it("reports autoEmbed even when the server reports the index as vectorSearch", () => {
            expect(
                resolveType({ name: "auto", type: "vectorSearch", latestDefinition: { fields: autoEmbedFields } })
            ).toBe("autoEmbed");
        });

        it("reports autoEmbed for a mixed autoEmbed and filter definition", () => {
            expect(
                resolveType({
                    name: "auto",
                    type: "vectorSearch",
                    latestDefinition: { fields: [...autoEmbedFields, { type: "filter", path: "age" }] },
                })
            ).toBe("autoEmbed");
        });
    });

    describe("other indexes resolve as before", () => {
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

        it("returns UNKNOWN for an unrecognizable definition", () => {
            expect(resolveType({ name: "empty" })).toBe("UNKNOWN");
        });
    });
});
