import { describeAccuracyTests } from "./sdk/describeAccuracyTests.js";

describeAccuracyTests([
    {
        prompt: "How many indexes do I have in 'mflix.movies' namespace?",
        expectedToolCalls: [
            {
                toolName: "collection-indexes",
                parameters: {
                    database: "mflix",
                    collection: "movies",
                },
            },
        ],
    },
    {
        prompt: "List all the indexes in movies collection in mflix database",
        expectedToolCalls: [
            {
                toolName: "collection-indexes",
                parameters: {
                    database: "mflix",
                    collection: "movies",
                },
            },
        ],
    },
    {
        prompt: `Is there an index covering the following query: ${JSON.stringify({ runtime: { $lt: 100 } })} on the namespace 'mflix.movies'?`,
        expectedToolCalls: [
            {
                toolName: "collection-indexes",
                parameters: {
                    database: "mflix",
                    collection: "movies",
                },
            },
        ],
    },
    {
        prompt: "how many search indexes do I have in the collection mydb.mycoll?",
        expectedToolCalls: [
            {
                toolName: "collection-indexes",
                parameters: {
                    database: "mydb",
                    collection: "mycoll",
                },
            },
        ],
    },
    {
        prompt: "which vector search indexes do I have in mydb.mycoll?",
        expectedToolCalls: [
            {
                toolName: "collection-indexes",
                parameters: {
                    database: "mydb",
                    collection: "mycoll",
                },
            },
        ],
    },
    {
        prompt: "Do I have an autoEmbed vector search index in 'mflix.movies' namespace",
        expectedToolCalls: [
            {
                toolName: "collection-indexes",
                parameters: {
                    database: "mflix",
                    collection: "movies",
                },
            },
        ],
    },
]);
