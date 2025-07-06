import { describeAccuracyTests, describeSuite } from "./sdk/describe-accuracy-tests.js";
import { getAvailableModels } from "./sdk/models.js";
import { AccuracyTestConfig } from "./sdk/describe-accuracy-tests.js";

function callsInsertMany(prompt: string): AccuracyTestConfig {
    return {
        injectConnectedAssumption: true,
        prompt: prompt,
        mockedTools: {},
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
        injectConnectedAssumption: true,
        prompt: prompt,
        mockedTools: {},
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

describeAccuracyTests(getAvailableModels(), {
    ...describeSuite("should call 'insert-many' tool", [
        callsInsertMany(
            [
                "In my namespace 'mflix.movies', insert 3 documents each with the following fields:",
                "- id: an incremental number starting from 1",
                "- name: a string of format 'name<id>'",
            ].join("\n")
        ),
        callsEmptyInsertMany("Add three empty documents in collection 'movies' inside database 'mflix'"),
    ]),
});
