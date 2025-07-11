import { describeAccuracyTests } from "./sdk/describe-accuracy-tests.js";
import { getAvailableModels } from "./sdk/models.js";
import { AccuracyTestConfig } from "./sdk/describe-accuracy-tests.js";

function callsInsertMany(prompt: string): AccuracyTestConfig {
    return {
        prompt: prompt,
        expectedToolCalls: [
            {
                toolName: "insert-many",
                parameters: {
                    database: "mflix",
                    collection: "movies",
                    documents: [
                        {
                            id: 1,
                            title: "name1",
                        },
                        {
                            id: 2,
                            title: "name2",
                        },
                        {
                            id: 3,
                            title: "name3",
                        },
                    ],
                },
            },
        ],
    };
}

function callsEmptyInsertMany(prompt: string) {
    return {
        prompt: prompt,
        expectedToolCalls: [
            {
                toolName: "insert-many",
                parameters: {
                    database: "mflix",
                    collection: "movies",
                    documents: [{}, {}, {}],
                },
            },
        ],
    };
}

describeAccuracyTests(getAvailableModels(), [
    callsInsertMany(
        [
            "In my namespace 'mflix.movies', insert 3 documents each with the following fields:",
            "- id: an incremental number starting from 1",
            "- name: a string of format 'name<id>'",
        ].join("\n")
    ),
    callsEmptyInsertMany("Add three empty documents in collection 'movies' inside database 'mflix'"),
]);
