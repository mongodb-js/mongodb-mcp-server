import { listDatabasesResponse } from "../../../src/tools/mongodb/metadata/listDatabases.js";
import { AccuracyTestConfig } from "../../accuracy/sdk/describe-accuracy-tests.js";

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

export const listDatabasesTests = {
    evalName: "should call list-databases tool",
    testConfigs: [
        callsListDatabases("How many databases do I have?"),
        callsListDatabases("List all the databases in my cluster."),
        callsListDatabases("Is there a sample_mflix database in my cluster?"),
    ],
};
