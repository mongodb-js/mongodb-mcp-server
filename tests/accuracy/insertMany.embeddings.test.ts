import { describeAccuracyTests } from "./sdk/describeAccuracyTests.js";
import { Matcher } from "./sdk/matcher.js";

/**
 * Accuracy tests for inserting documents with automatic vector embeddings generation.
 * Tests scenarios where raw text strings are provided and automatically converted to embeddings.
 */
describeAccuracyTests(
    [
        {
            prompt: "Insert a document into 'mflix.movies' collection with title 'The Matrix' and a plotSummary field with the text 'A computer hacker learns about the true nature of his reality'. Use the plot summary to generate the 'embeddings' field using the voyage-3 model.",
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
                                embeddings: {
                                    plotSummary: "A computer hacker learns about the true nature of his reality",
                                },
                            },
                        ],
                        embeddingParameters: {
                            model: "voyage-3",
                        },
                    },
                },
            ],
        },
    ],
    {
        userConfig: { voyageApiKey: "valid-key" },
        clusterConfig: {
            search: true,
        },
    }
);
