import { describeAccuracyTests } from "./sdk/describe-accuracy-tests.js";
import { getAvailableModels } from "./sdk/models.js";
import { AccuracyTestConfig } from "./sdk/describe-accuracy-tests.js";
import { deleteManyResponse } from "../../src/tools/mongodb/delete/deleteMany.js";

function callsDeleteManyWithEmptyFilters(prompt: string): AccuracyTestConfig {
    return {
        injectConnectedAssumption: true,
        prompt: prompt,
        mockedTools: {
            "delete-many": function listDatabases() {
                return deleteManyResponse("coll1", 10);
            },
        },
        expectedToolCalls: [
            {
                toolName: "delete-many",
                parameters: {
                    database: "db1",
                    collection: "coll1",
                },
            },
        ],
    };
}

function callsDeleteManyWithFilters(prompt: string): AccuracyTestConfig {
    return {
        injectConnectedAssumption: true,
        prompt: prompt,
        mockedTools: {
            "delete-many": function listDatabases() {
                return deleteManyResponse("coll1", 10);
            },
        },
        expectedToolCalls: [
            {
                toolName: "delete-many",
                parameters: {
                    database: "db1",
                    collection: "coll1",
                    filters: { provider: "BongoDB" },
                },
            },
        ],
    };
}

describeAccuracyTests("delete-many", getAvailableModels(), [
    callsDeleteManyWithEmptyFilters("Delete all the documents from 'db1.coll1' namespace"),
    callsDeleteManyWithEmptyFilters("Purge the collection 'coll1' in database 'db1'"),
    callsDeleteManyWithFilters("Remove all the documents from namespace 'db1.coll1' where provider is 'BongoDB'"),
]);
