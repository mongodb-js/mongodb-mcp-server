import { describeAccuracyTests } from "./sdk/describeAccuracyTests.js";
import { Matcher } from "./sdk/matcher.js";

describeAccuracyTests([
    {
        prompt: "Get the current operations running on the admin database, limit to 5 results",
        expectedToolCalls: [
            {
                toolName: "aggregate-db",
                parameters: {
                    database: "admin",
                    pipeline: [
                        {
                            $currentOp: {
                                allUsers: true,
                                idleSessions: Matcher.anyOf(Matcher.undefined, Matcher.boolean(false)),
                            },
                        },
                        {
                            $limit: 5,
                        },
                    ],
                    responseBytesLimit: Matcher.anyOf(Matcher.number(), Matcher.undefined),
                },
            },
        ],
    },
    {
        prompt: "I want to test this query: { $match: { age: { $gt: 28 } } }. I don't have a collection yet. Can you test it using $documents with these records: {name: 'Alice', age: 25}, {name: 'Bob', age: 30}, {name: 'Charlie', age: 35}?",
        expectedToolCalls: [
            {
                toolName: "aggregate-db",
                parameters: {
                    database: Matcher.string(),
                    pipeline: [
                        {
                            $documents: [
                                { name: "Alice", age: 25 },
                                { name: "Bob", age: 30 },
                                { name: "Charlie", age: 35 },
                            ],
                        },
                        {
                            $match: {
                                age: Matcher.value({ $gt: 28 }),
                            },
                        },
                    ],
                    responseBytesLimit: Matcher.anyOf(Matcher.number(), Matcher.undefined),
                },
            },
        ],
    },
    {
        prompt: "List all local sessions on the admin database",
        expectedToolCalls: [
            {
                toolName: "aggregate-db",
                parameters: {
                    database: "admin",
                    pipeline: [
                        {
                            $listLocalSessions: Matcher.value({}),
                        },
                    ],
                    responseBytesLimit: Matcher.anyOf(Matcher.number(), Matcher.undefined),
                },
            },
        ],
    },
]);
