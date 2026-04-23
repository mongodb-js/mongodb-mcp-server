import { describeAccuracyTests } from "./sdk/describeAccuracyTests.js";
import { Matcher } from "./sdk/matcher.js";

describeAccuracyTests([
    {
        prompt: "Delete all the documents from 'mflix.movies' namespace",
        expectedToolCalls: [
            {
                toolName: "delete-many",
                parameters: {
                    database: "mflix",
                    collection: "movies",
                    filter: Matcher.emptyObjectOrUndefined,
                },
            },
        ],
    },
    {
        prompt: "Purge the collection 'movies' in database 'mflix'",
        expectedToolCalls: [
            {
                toolName: "delete-many",
                parameters: {
                    database: "mflix",
                    collection: "movies",
                    filter: Matcher.emptyObjectOrUndefined,
                },
            },
        ],
    },
    {
        prompt: "Remove all the documents from namespace 'mflix.movies' where runtime is less than 100",
        expectedToolCalls: [
            {
                toolName: "delete-many",
                parameters: {
                    database: "mflix",
                    collection: "movies",
                    filter: { runtime: { $lt: 100 } },
                },
            },
        ],
    },
]);
