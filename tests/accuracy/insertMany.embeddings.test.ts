import { describeAccuracyTests } from "./sdk/describeAccuracyTests.js";
import { Matcher } from "./sdk/matcher.js";

/**
 * Accuracy tests for inserting documents with automatic vector embeddings generation.
 * Tests scenarios where raw text strings are provided and automatically converted to embeddings.
 */
describeAccuracyTests(
    [
        {
            prompt: "Insert a document into 'mflix.movies' collection with title 'The Matrix' and a plotSummary field with the text 'A computer hacker learns about the true nature of his reality'. Generate embeddings automatically using the voyage-3 model.",
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
                            },
                        ],
                        embeddingParameters: {
                            model: "voyage-3",
                        },
                    },
                },
            ],
        },
        {
            prompt: "Add a movie to 'mflix.movies' with title 'Inception', year 2010, and plotSummary 'A thief who steals corporate secrets through dream-sharing technology'. Use voyage-3-lite model for automatic embeddings.",
            expectedToolCalls: [
                {
                    toolName: "insert-many",
                    parameters: {
                        database: "mflix",
                        collection: "movies",
                        documents: [
                            {
                                title: "Inception",
                                year: 2010,
                                plotSummary: "A thief who steals corporate secrets through dream-sharing technology",
                            },
                        ],
                        embeddingParameters: {
                            model: Matcher.string(),
                        },
                    },
                },
            ],
        },
        {
            prompt: "Insert multiple movies into 'mflix.movies' with automatic embeddings using voyage-3 model. Add: 1) 'Avatar' with plot 'A marine on an alien planet', 2) 'Titanic' with plot 'A romance on a doomed ship', 3) 'Jurassic Park' with plot 'Dinosaurs brought back to life'.",
            expectedToolCalls: [
                {
                    toolName: "insert-many",
                    parameters: {
                        database: "mflix",
                        collection: "movies",
                        documents: [
                            {
                                title: "Avatar",
                                plotSummary: Matcher.string(),
                            },
                            {
                                title: "Titanic",
                                plotSummary: Matcher.string(),
                            },
                            {
                                title: "Jurassic Park",
                                plotSummary: Matcher.string(),
                            },
                        ],
                        embeddingParameters: {
                            model: "voyage-3",
                        },
                    },
                },
            ],
        },
        {
            prompt: "Insert a document into 'mflix.movies' with title 'Interstellar' and use embeddingParameters input to provide custom text for plotSummary field: 'Space exploration and time dilation'. Use voyage-3 model.",
            expectedToolCalls: [
                {
                    toolName: "insert-many",
                    parameters: {
                        database: "mflix",
                        collection: "movies",
                        documents: [
                            {
                                title: "Interstellar",
                            },
                        ],
                        embeddingParameters: {
                            model: "voyage-3",
                            input: [
                                {
                                    plotSummary: "Space exploration and time dilation",
                                },
                            ],
                        },
                    },
                },
            ],
        },
        {
            prompt: "Add a movie 'The Dark Knight' to 'mflix.movies' with multiple embedding fields. Use raw text 'Batman fights the Joker' for plotSummary and 'Action, Crime, Drama' for genre. Generate embeddings with voyage-3 model.",
            expectedToolCalls: [
                {
                    toolName: "insert-many",
                    parameters: {
                        database: "mflix",
                        collection: "movies",
                        documents: [
                            {
                                title: "The Dark Knight",
                                plotSummary: Matcher.string(),
                                genre: Matcher.string(),
                            },
                        ],
                        embeddingParameters: {
                            model: "voyage-3",
                        },
                    },
                },
            ],
        },
        {
            prompt: "Insert a document into 'mflix.movies' with title 'Pulp Fiction' and nested embedding field 'embeddings.plot' containing text 'Multiple interconnected crime stories'. Use voyage-3 for automatic embeddings.",
            expectedToolCalls: [
                {
                    toolName: "insert-many",
                    parameters: {
                        database: "mflix",
                        collection: "movies",
                        documents: [
                            {
                                title: "Pulp Fiction",
                                embeddings: {
                                    plot: Matcher.string(),
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
        {
            prompt: "Insert two documents into 'mflix.movies' using embeddingParameters input for custom text. Add 'Forrest Gump' with input text 'Life is like a box of chocolates' and 'The Godfather' with input text 'An offer you cannot refuse'. Use voyage-3 model.",
            expectedToolCalls: [
                {
                    toolName: "insert-many",
                    parameters: {
                        database: "mflix",
                        collection: "movies",
                        documents: [
                            {
                                title: "Forrest Gump",
                            },
                            {
                                title: "The Godfather",
                            },
                        ],
                        embeddingParameters: {
                            model: "voyage-3",
                            input: [
                                {
                                    plotSummary: Matcher.string(),
                                },
                                {
                                    plotSummary: Matcher.string(),
                                },
                            ],
                        },
                    },
                },
            ],
        },
        {
            prompt: "Add a movie 'Star Wars' to 'mflix.movies' with mixed approach: provide raw text 'Space opera saga' in plotSummary field and use embeddingParameters input to provide 'Epic space battles' for genre field. Use voyage-3 model.",
            expectedToolCalls: [
                {
                    toolName: "insert-many",
                    parameters: {
                        database: "mflix",
                        collection: "movies",
                        documents: [
                            {
                                title: "Star Wars",
                                plotSummary: Matcher.string(),
                            },
                        ],
                        embeddingParameters: {
                            model: "voyage-3",
                            input: [
                                {
                                    genre: Matcher.string(),
                                },
                            ],
                        },
                    },
                },
            ],
        },
        {
            prompt: "Insert a document into 'mflix.movies' with title 'Blade Runner' and specify voyage-3-lite model with document inputType for automatic embedding generation. Use text 'Dystopian future with replicants' for plotSummary.",
            expectedToolCalls: [
                {
                    toolName: "insert-many",
                    parameters: {
                        database: "mflix",
                        collection: "movies",
                        documents: [
                            {
                                title: "Blade Runner",
                                plotSummary: Matcher.string(),
                            },
                        ],
                        embeddingParameters: {
                            model: Matcher.string(),
                            inputType: Matcher.anyOf(Matcher.string(), Matcher.undefined),
                        },
                    },
                },
            ],
        },
        {
            prompt: "Add multiple movies to 'mflix.movies' with different text lengths for automatic embeddings. Include 'Casablanca' with short text 'Love in wartime', 'Gone with the Wind' with medium text 'Epic tale of the American Civil War and its aftermath', and 'Citizen Kane' with long detailed plot description. Use voyage-3 model.",
            expectedToolCalls: [
                {
                    toolName: "insert-many",
                    parameters: {
                        database: "mflix",
                        collection: "movies",
                        documents: [
                            {
                                title: "Casablanca",
                                plotSummary: Matcher.string(),
                            },
                            {
                                title: "Gone with the Wind",
                                plotSummary: Matcher.string(),
                            },
                            {
                                title: "Citizen Kane",
                                plotSummary: Matcher.string(),
                            },
                        ],
                        embeddingParameters: {
                            model: "voyage-3",
                        },
                    },
                },
            ],
        },
        {
            prompt: "Insert a document into 'mflix.movies' with title 'The Lord of the Rings' and use embeddingParameters input array to provide different texts for multiple embedding fields: plotSummary='Fantasy epic quest', genre='Fantasy Adventure', themes='Good vs Evil'.",
            expectedToolCalls: [
                {
                    toolName: "insert-many",
                    parameters: {
                        database: "mflix",
                        collection: "movies",
                        documents: [
                            {
                                title: "The Lord of the Rings",
                            },
                        ],
                        embeddingParameters: {
                            model: Matcher.string(),
                            input: [
                                {
                                    plotSummary: Matcher.string(),
                                    genre: Matcher.string(),
                                    themes: Matcher.string(),
                                },
                            ],
                        },
                    },
                },
            ],
        },
        {
            prompt: "Add a movie 'Dune' to 'mflix.movies' with automatic embeddings. Provide raw text in the document for plotSummary field: 'Desert planet with spice mining'. Use voyage-3 model and ensure the text gets converted to embeddings automatically.",
            expectedToolCalls: [
                {
                    toolName: "insert-many",
                    parameters: {
                        database: "mflix",
                        collection: "movies",
                        documents: [
                            {
                                title: "Dune",
                                plotSummary: Matcher.string(),
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
