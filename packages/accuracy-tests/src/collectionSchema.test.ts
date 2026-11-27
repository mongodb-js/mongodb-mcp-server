import { describeAccuracyTests } from "./sdk/describeAccuracyTests.js";
import { Matcher } from "./sdk/matcher.js";

const listCollectionsOptionalCall = {
    toolName: "list-collections",
    parameters: {
        database: "mflix",
    },
    optional: true,
};

describeAccuracyTests([
    {
        prompt: "Is there a title field in 'mflix.movies' namespace?",
        expectedToolCalls: [
            listCollectionsOptionalCall,
            {
                toolName: "collection-schema",
                parameters: {
                    database: "mflix",
                    collection: "movies",
                    schemaSource: Matcher.anyOf(Matcher.undefined, Matcher.value("auto")),
                    sampleSize: Matcher.anyOf(Matcher.undefined, Matcher.number()),
                    responseBytesLimit: Matcher.anyOf(Matcher.undefined, Matcher.number()),
                },
            },
        ],
    },
    {
        prompt: "What is the type of value stored in title field in movies collection in mflix database?",
        expectedToolCalls: [
            listCollectionsOptionalCall,
            {
                toolName: "collection-schema",
                parameters: {
                    database: "mflix",
                    collection: "movies",
                    schemaSource: Matcher.anyOf(Matcher.undefined, Matcher.value("auto")),
                    sampleSize: Matcher.anyOf(Matcher.undefined, Matcher.number()),
                    responseBytesLimit: Matcher.anyOf(Matcher.undefined, Matcher.number()),
                },
            },
        ],
    },
    {
        prompt: "What fields does the schema validator on the mflix.movies collection allow?",
        expectedToolCalls: [
            listCollectionsOptionalCall,
            {
                toolName: "collection-schema",
                parameters: {
                    database: "mflix",
                    collection: "movies",
                    schemaSource: "validator",
                },
            },
        ],
    },
    {
        prompt: "Ignoring any schema validation rules, sample 100 documents from mflix.movies and tell me what fields they actually contain.",
        expectedToolCalls: [
            listCollectionsOptionalCall,
            {
                toolName: "collection-schema",
                parameters: {
                    database: "mflix",
                    collection: "movies",
                    schemaSource: "sample",
                    sampleSize: 100,
                    responseBytesLimit: Matcher.anyOf(Matcher.undefined, Matcher.number()),
                },
            },
        ],
    },
]);
