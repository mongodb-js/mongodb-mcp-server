import { runEval } from "./infra/scaffolding.js";

const context =
    "You are a MongoDB expert. For all operations use the 'movies' collection by default.";

const mflixMovies = {
    collection: "movies",
    documents: "tests/accuracy/test-data-dumps/mflix.movies-with-plot.json",
};

runEval({
    clusterConfig: { search: true },
    maxConcurrency: 5,
    experimentName: "search-benchmark-<model_name>",
    id: "idx-management",
    tags: ["<model_name>", "search-benchmark", "index-management"],
    data: [
        {
            id: "idx-create-dynamic",
            input: {
                systemPrompt: context,
                userPrompt: "Create a search index on 'movies' collection with dynamic mapping.",
                dbClusterSeed: {
                    collections: [mflixMovies],
                },
            },
            assertions:
                "Look up all indexes of 'movies' you should see one search index with dynamic mapping.",
        },
        {
            id: "idx-delete",
            input: {
                systemPrompt: context,
                userPrompt: "Remove index 'movies_title_text'.",
                followUpInstructions: [
                    "If after a failed attempt assistant suggests another action that could potentially lead to successfully deleting it, allow it.",
                ],
                dbClusterSeed: {
                    collections: [
                        {
                            ...mflixMovies,
                            indexes: [
                                {
                                    type: "search",
                                    name: "movies_title_text",
                                    definition: { mappings: { fields: { title: { type: "string" } } } },
                                },
                            ],
                        },
                    ],
                },
            },
            assertions: [
                "Confirm that a 'search' index with 'movies_title_text' is found and successfully deleted from 'movies' collection.",
                "If assistant fails to find the index eventually consider the test failed.",
                "Reduce score by 25% if it needed user intervention to delete the index.",
            ],
        },
        {
            id: "idx-query-must",
            input: {
                systemPrompt: context,
                userPrompt: "Find movies with 'Romance' in genres and 'rich British person in India' (use text search) in its plot.",
                dbClusterSeed: {
                    collections: [{
                        ...mflixMovies,
                        indexes: [
                            {
                                type: "search",
                                name: "movies_plot_text",
                                definition: { mappings: { fields: { plot: { type: "string" } } } },
                            },
                        ],
                    }]
                },
            },
            assertions:
                "The assistant is expected to return at least 1 document, the first returned result should be the document with id 'fbf30e42-ae6d-4775-bb3e-c5c127ddea06' from 'movies' collection.",
        }
    ],
});
