import { describeAccuracyTests } from "./sdk/describeAccuracyTests.js";
import { Matcher } from "./sdk/matcher.js";

const embeddingParameters = {
    model: "voyage-3",
    outputDimension: Matcher.anyOf(
        Matcher.undefined,
        Matcher.number((n) => n === 1024)
    ),
    outputDType: Matcher.anyOf(Matcher.undefined, Matcher.value("float")),
};

/**
 * Accuracy tests for inserting documents with automatic vector embeddings generation.
 * Tests scenarios where raw text strings are provided and automatically converted to embeddings.
 */
describeAccuracyTests(
    [
        {
            prompt: "Insert a document into 'mflix.movies' collection with title 'The Matrix' and a plotSummary field with the text 'A computer hacker learns about the true nature of his reality' and a 'plotSummaryEmbeddings' field which should be generated using the voyage-3.5 model.",
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
                                plotSummaryEmbeddings: "A computer hacker learns about the true nature of his reality",
                            },
                        ],
                        embeddingParameters: {
                            model: "voyage-3.5",
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
