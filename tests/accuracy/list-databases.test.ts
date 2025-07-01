import { describeAccuracyTests } from "./sdk/describe-accuracy-tests.js";
import { getAvailableModels } from "./sdk/models.js";
import { AccuracyTestConfig } from "./sdk/describe-accuracy-tests.js";
import { listDatabasesResponse } from "../../src/tools/mongodb/metadata/listDatabases.js";

function callsListDatabases(prompt: string): AccuracyTestConfig {
    return {
        injectConnectedAssumption: true,
        prompt: prompt,
        mockedTools: {
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
        ],
    };
}

describeAccuracyTests("list-databases", getAvailableModels(), [
    callsListDatabases("How many databases do I have?"),
    callsListDatabases("List all the databases in my cluster."),
    callsListDatabases("Is there a sample_mflix database in my cluster?"),
]);
