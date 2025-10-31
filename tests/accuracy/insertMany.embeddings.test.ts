import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { describeAccuracyTests } from "./sdk/describeAccuracyTests.js";
import { Matcher } from "./sdk/matcher.js";

const embeddingParameters = {
    model: "voyage-3.5",
    outputDimension: Matcher.anyOf(
        Matcher.undefined,
        Matcher.number((n) => n === 1024)
    ),
    outputDType: Matcher.anyOf(Matcher.undefined, Matcher.value("float")),
};

const mockInsertMany = (): CallToolResult => {
    return {
        content: [
            {
                type: "text",
                text: "Documents were inserted successfully.",
            },
        ],
    };
};

/**
 * Accuracy tests for inserting documents with automatic vector embeddings generation.
 */
describeAccuracyTests(
    [
        {
            prompt: "Insert 2 documents in one call into 'mflix.movies' collection - document should have a 'title' field that has generated embeddings using the voyage-3.5 model: 'The Matrix' and 'Blade Runner'. Assume the collection already exists and has vector index on the 'title' field.",
            expectedToolCalls: [
                {
                    toolName: "insert-many",
                    parameters: {
                        database: "mflix",
                        collection: "movies",
                        documents: [
                            {
                                // The title field might be specified, sometimes as "The Matrix" or "Placeholder". This will be overwritten by the embeddings so this is fine.
                                title: Matcher.anyOf(Matcher.undefined, Matcher.null, Matcher.string()),
                            },
                            {
                                title: Matcher.anyOf(Matcher.undefined, Matcher.null, Matcher.string()),
                            },
                        ],
                        embeddingParameters: {
                            ...embeddingParameters,
                            input: [
                                {
                                    title: "The Matrix",
                                },
                                {
                                    title: "Blade Runner",
                                },
                            ],
                        },
                    },
                },
            ],
        },
        {
            prompt: "Insert a document into 'mflix.movies' collection with following fields: title is 'The Matrix', plotSummary is 'A computer hacker learns about the true nature of his reality', generate the necesssary vector embeddings for the 'plotSummaryEmbeddings' field using the voyage-3.5 model. Assume the collection already exists and has vector index on the 'plotSummaryEmbeddings' field.",
            expectedToolCalls: [
                {
                    toolName: "insert-many",
                    parameters: {
                        database: "mflix",
                        collection: "movies",
                        documents: [
                            {
                                title: "The Matrix",
                                plotSummary: "A computer hacker learns about the true nature of his reality",
                                plotSummaryEmbeddings: Matcher.anyOf(Matcher.undefined, Matcher.null, Matcher.string()),
                            },
                        ],
                        embeddingParameters: {
                            ...embeddingParameters,
                            input: [
                                {
                                    plotSummaryEmbeddings:
                                        "A computer hacker learns about the true nature of his reality",
                                },
                            ],
                        },
                    },
                },
            ],
        },
        {
            prompt: "Insert 2 documents in one call into 'mflix.movies' collection - the movie titles are 1. 'The Matrix' and 2. 'Blade Runner'.  They should have an info field which has 2 subfields: 'title' and 'titleEmbeddings'. Generate the embeddings for the 'info.titleEmbeddings' subfield using the voyage-3.5 model. Assume the collection already exists and has vector index on the 'info.titleEmbeddings' field.",
            expectedToolCalls: [
                {
                    toolName: "insert-many",
                    parameters: {
                        database: "mflix",
                        collection: "movies",
                        documents: [
                            {
                                info: {
                                    titleEmbeddings: Matcher.anyOf(Matcher.undefined, Matcher.null, Matcher.string()),
                                    title: "The Matrix",
                                },
                            },
                            {
                                info: {
                                    titleEmbeddings: Matcher.anyOf(Matcher.undefined, Matcher.null, Matcher.string()),
                                    title: "Blade Runner",
                                },
                            },
                        ],
                        embeddingParameters: {
                            ...embeddingParameters,
                            input: [
                                {
                                    "info.titleEmbeddings": "The Matrix",
                                },
                                {
                                    "info.titleEmbeddings": "Blade Runner",
                                },
                            ],
                        },
                    },
                },
            ],
            mockedTools: {
                "insert-many": mockInsertMany,
            },
        },
        {
            prompt: "Insert a document into 'mflix.movies' collection with title 'The Matrix' and generate the necesssary vector embeddings for the current vector search fields using the voyage-3.5 model.",
            expectedToolCalls: [
                {
                    toolName: "collection-indexes",
                    parameters: {
                        database: "mflix",
                        collection: "movies",
                    },
                },
                {
                    toolName: "insert-many",
                    parameters: {
                        database: "mflix",
                        collection: "movies",
                        documents: [
                            {
                                title: "The Matrix",
                                title_embeddings: Matcher.anyOf(Matcher.undefined, Matcher.null, Matcher.string()),
                            },
                        ],
                        embeddingParameters: {
                            ...embeddingParameters,
                            input: [
                                {
                                    title_embeddings: "The Matrix",
                                },
                            ],
                        },
                    },
                },
            ],
            mockedTools: {
                "insert-many": mockInsertMany,
                "collection-indexes": (): CallToolResult => {
                    return {
                        content: [
                            {
                                type: "text",
                                text: JSON.stringify({
                                    name: "title_embeddings",
                                    type: "vectorSearch",
                                    status: "READY",
                                    queryable: true,
                                    latestDefinition: {
                                        type: "vector",
                                        path: "title_embeddings",
                                        numDimensions: 1024,
                                        quantization: "none",
                                        similarity: "euclidean",
                                    },
                                }),
                            },
                        ],
                    };
                },
            },
        },
    ],
    {
        userConfig: { voyageApiKey: "valid-key", previewFeatures: "vectorSearch" },
        clusterConfig: {
            search: true,
        },
    }
);
