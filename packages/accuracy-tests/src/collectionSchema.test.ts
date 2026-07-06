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
                    sampleSize: Matcher.anyOf(Matcher.undefined, Matcher.number()),
                    responseBytesLimit: Matcher.anyOf(Matcher.undefined, Matcher.number()),
                },
            },
        ],
    },
]);
