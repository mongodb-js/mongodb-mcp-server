import { describeAccuracyTests } from "./sdk/describe-accuracy-tests.js";
import { getAvailableModels } from "./sdk/models.js";
import { AccuracyTestConfig } from "./sdk/describe-accuracy-tests.js";
import { insertManyResponse } from "../../src/tools/mongodb/create/insertMany.js";

function callsInsertMany(prompt: string): AccuracyTestConfig {
    return {
        injectConnectedAssumption: true,
        prompt: prompt,
        mockedTools: {
            "insert-many": function listDatabases() {
                return insertManyResponse("coll1", 3, ["1FOO", "2BAR", "3BAZ"]);
            },
        },
        expectedToolCalls: [
            {
                toolName: "insert-many",
                parameters: {
                    database: "db1",
                    collection: "coll1",
                    documents: [
                        {
                            id: 1,
                            name: "name1",
                        },
                        {
                            id: 2,
                            name: "name2",
                        },
                        {
                            id: 3,
                            name: "name3",
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
        mockedTools: {
            "insert-many": function listDatabases() {
                return insertManyResponse("coll1", 3, ["1FOO", "2BAR", "3BAZ"]);
            },
        },
        expectedToolCalls: [
            {
                toolName: "insert-many",
                parameters: {
                    database: "db1",
                    collection: "coll1",
                    documents: [{}, {}, {}],
                },
            },
        ],
    };
}

describeAccuracyTests("insert-many", getAvailableModels(), [
    callsInsertMany(
        [
            "In my namespace 'db1.coll1', insert 3 documents each with the following fields:",
            "- id: an incremental number starting from 1",
            "- name: a string of format 'name<id>'",
        ].join("\n")
    ),
    callsEmptyInsertMany("Add three empty documents in collection 'coll1' inside database 'db1'"),
]);
