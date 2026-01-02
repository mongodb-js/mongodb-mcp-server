import { describeAccuracyTests } from "./sdk/describeAccuracyTests.js";
import { Matcher } from "./sdk/matcher.js";
import type { LLMToolCall } from "./sdk/accuracyResultStorage/resultStorage.js";

// Generate documents with large descriptions to test payload splitting
// Each document is ~12KB, so 10 docs = ~120KB which exceeds the 100KB HTTP limit
function generateLargeDocuments(
    count: number,
    descriptionSize: number
): Array<{ id: number; name: string; description: string }> {
    return Array.from({ length: count }, (_, i) => ({
        id: i + 1,
        name: `user${i + 1}`,
        description: "X".repeat(descriptionSize),
    }));
}

const LARGE_DOCS = generateLargeDocuments(10, 12000); // 10 docs × ~12KB each = ~120KB total

describeAccuracyTests([
    {
        prompt: [
            "In my namespace 'mflix.movies', insert 3 documents each with the following fields:",
            "- id: an incremental number starting from 1",
            "- name: a string of format 'name<id>'",
        ].join("\n"),
        expectedToolCalls: [
            {
                toolName: "insert-many",
                parameters: {
                    database: "mflix",
                    collection: "movies",
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
    },
    {
        prompt: "Add three empty documents in one go in collection 'movies' inside database 'mflix'",
        expectedToolCalls: [
            {
                toolName: "insert-many",
                parameters: {
                    database: "mflix",
                    collection: "movies",
                    documents: [{ _id: Matcher.anyValue }, { _id: Matcher.anyValue }, { _id: Matcher.anyValue }],
                },
            },
        ],
    },
    {
        prompt: [
            "Insert the following documents into 'test.users'.",
            "Here are the documents:",
            JSON.stringify(LARGE_DOCS, null, 2),
        ].join("\n"),
        expectedToolCalls: [
            {
                toolName: "insert-many",
                parameters: {
                    database: "test",
                    collection: "users",
                    documents: Matcher.anyValue, // First batch
                },
            },
            {
                toolName: "insert-many",
                parameters: {
                    database: "test",
                    collection: "users",
                    documents: Matcher.anyValue, // Second batch
                },
            },
            {
                toolName: "insert-many",
                parameters: {
                    database: "test",
                    collection: "users",
                    documents: Matcher.anyValue, // Third batch (or more)
                },
                optional: true,
            },
        ],
    },
]);
