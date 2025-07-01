import { describeAccuracyTests } from "./sdk/describe-accuracy-tests.js";
import { getAvailableModels } from "./sdk/models.js";
import { AccuracyTestConfig } from "./sdk/describe-accuracy-tests.js";
import { listCollectionsResponse } from "../../src/tools/mongodb/metadata/listCollections.js";
import { listDatabasesResponse } from "../../src/tools/mongodb/metadata/listDatabases.js";

function callsListCollections(prompt: string): AccuracyTestConfig {
    return {
        injectConnectedAssumption: true,
        prompt: prompt,
        mockedTools: {
            "list-collections": function listCollections() {
                return listCollectionsResponse("db1", ["coll1", "coll2"]);
            },
        },
        expectedToolCalls: [
            {
                toolName: "list-collections",
                parameters: { database: "db1" },
            },
        ],
    };
}

function callsListDatabasesAndListCollections(prompt: string): AccuracyTestConfig {
    return {
        injectConnectedAssumption: true,
        prompt: prompt,
        mockedTools: {
            "list-collections": function listCollections() {
                return listCollectionsResponse("db1", ["coll1", "coll2"]);
            },
            "list-databases": function listDatabases() {
                return listDatabasesResponse([
                    {
                        name: "db1",
                        sizeOnDisk: "1024",
                    },
                    {
                        name: "db2",
                        sizeOnDisk: "2048",
                    },
                ]);
            },
        },
        expectedToolCalls: [
            {
                toolName: "list-databases",
                parameters: {},
            },
            {
                toolName: "list-collections",
                parameters: { database: "db1" },
            },
            {
                toolName: "list-collections",
                parameters: { database: "db2" },
            },
        ],
    };
}

describeAccuracyTests("list-collections", getAvailableModels(), [
    callsListCollections("How many collections do I have in database db1?"),
    callsListCollections("List all the collections in my MongoDB database db1."),
    callsListCollections("Is there a coll1 collection in my MongoDB database db1?"),
    callsListDatabasesAndListCollections("List all the collections that I have in total on my cluster?"),
]);
