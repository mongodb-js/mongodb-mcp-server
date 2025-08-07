import { describeAccuracyTests } from "./sdk/describeAccuracyTests.js";
import { Matcher } from "./sdk/matcher.js";

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
        prompt: "Add three empty documents in collection 'movies' inside database 'mflix'",
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
]);
