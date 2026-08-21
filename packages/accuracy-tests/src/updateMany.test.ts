import { describeAccuracyTests } from "./sdk/describeAccuracyTests.js";
import { Matcher } from "./sdk/matcher.js";

describeAccuracyTests([
    {
        prompt: "Update all the documents in 'mflix.movies' namespace with a new field 'new_field' set to 1",
        expectedToolCalls: [
            {
                toolName: "update-many",
                parameters: {
                    database: "mflix",
                    collection: "movies",
                    update: {
                        $set: {
                            new_field: 1,
                        },
                    },
                    upsert: Matcher.anyOf(Matcher.undefined, Matcher.boolean()),
                },
            },
        ],
    },
    {
        prompt: "Update all the documents in 'mflix.movies' namespace, where runtime is less than 100, with a new field 'new_field' set to 1",
        expectedToolCalls: [
            {
                toolName: "update-many",
                parameters: {
                    database: "mflix",
                    collection: "movies",
                    filter: { runtime: { $lt: 100 } },
                    update: {
                        $set: {
                            new_field: 1,
                        },
                    },
                    upsert: Matcher.anyOf(Matcher.undefined, Matcher.boolean()),
                },
            },
        ],
    },
]);
