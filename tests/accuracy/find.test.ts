import { describeAccuracyTests } from "./sdk/describe-accuracy-tests.js";
import { getAvailableModels } from "./sdk/models.js";
import { AccuracyTestConfig } from "./sdk/describe-accuracy-tests.js";
import { findResponse } from "../../src/tools/mongodb/read/find.js";
import { MockedTools } from "./sdk/test-tools.js";
import { collectionSchemaResponse } from "../../src/tools/mongodb/metadata/collectionSchema.js";
import { getSimplifiedSchema } from "mongodb-schema";

const documents = [
    {
        title: "book1",
        author: "author1",
        date_of_publish: "01.01.1990",
    },
    {
        title: "book2",
        author: "author1",
        date_of_publish: "01.01.1992",
    },
    {
        title: "book3",
        author: "author2",
        date_of_publish: "01.01.1990",
    },
];

function callsFindNoFilter(prompt: string): AccuracyTestConfig {
    return {
        injectConnectedAssumption: true,
        prompt: prompt,
        mockedTools: {
            "collection-schema": async () =>
                collectionSchemaResponse("db1", "coll1", await getSimplifiedSchema(documents)),
            find: () => findResponse("coll1", documents),
        },
        expectedToolCalls: [
            {
                toolName: "find",
                parameters: {
                    database: "db1",
                    collection: "coll1",
                },
            },
        ],
    };
}

function callsFindWithFilter(prompt: string): AccuracyTestConfig {
    return {
        injectConnectedAssumption: true,
        prompt: prompt,
        mockedTools: {
            "collection-schema": async () =>
                collectionSchemaResponse("db1", "coll1", await getSimplifiedSchema(documents)),
            find: () =>
                findResponse(
                    "coll1",
                    documents.filter((doc) => doc.author === "author1")
                ),
        },
        expectedToolCalls: [
            {
                toolName: "find",
                parameters: {
                    database: "db1",
                    collection: "coll1",
                    filter: { author: "author1" },
                },
            },
        ],
    };
}

function callsFindWithProjection(prompt: string): AccuracyTestConfig {
    return {
        injectConnectedAssumption: true,
        prompt: prompt,
        mockedTools: {
            "collection-schema": async () =>
                collectionSchemaResponse("db1", "coll1", await getSimplifiedSchema(documents)),
            find: () => findResponse("coll1", documents),
        },
        expectedToolCalls: [
            {
                toolName: "find",
                parameters: {
                    database: "db1",
                    collection: "coll1",
                    projection: { title: 1 },
                },
            },
        ],
    };
}

function callsFindWithProjectionAndFilters(prompt: string): AccuracyTestConfig {
    return {
        injectConnectedAssumption: true,
        prompt: prompt,
        mockedTools: {
            "collection-schema": async () =>
                collectionSchemaResponse("db1", "coll1", await getSimplifiedSchema(documents)),
            find: () =>
                findResponse(
                    "coll1",
                    documents.filter((doc) => doc.date_of_publish === "01.01.1992")
                ),
        },
        expectedToolCalls: [
            {
                toolName: "find",
                parameters: {
                    database: "db1",
                    collection: "coll1",
                    filter: { date_of_publish: "01.01.1992" },
                    projection: { title: 1 },
                },
            },
        ],
    };
}

function callsFindWithSortAndLimit(prompt: string): AccuracyTestConfig {
    return {
        injectConnectedAssumption: true,
        prompt: prompt,
        mockedTools: {
            "collection-schema": async () =>
                collectionSchemaResponse("db1", "coll1", await getSimplifiedSchema(documents)),
            find: () => findResponse("coll1", [documents[0], documents[1]]),
        },
        expectedToolCalls: [
            {
                toolName: "find",
                parameters: {
                    database: "db1",
                    collection: "coll1",
                    sort: { date_of_publish: 1 },
                    limit: 2,
                },
            },
        ],
    };
}

describeAccuracyTests("find", getAvailableModels(), [
    callsFindNoFilter("List all the documents in 'db1.coll1' namespace"),
    callsFindNoFilter("Find all the documents from collection coll1 in database db1"),
    callsFindWithFilter("Find all the books published by author name 'author1' in db1.coll1 namespace"),
    callsFindWithFilter("Find all the documents in coll1 collection and db1 database where author is 'author1'"),
    callsFindWithProjection("Give me all the title of the books available in 'db1.coll1' namespace"),
    callsFindWithProjection("Give me all the title of the books published in  available in 'db1.coll1' namespace"),
    callsFindWithProjectionAndFilters(
        "Find all the book titles from 'db1.coll1' namespace where date_of_publish is '01.01.1992'"
    ),
    callsFindWithSortAndLimit("List first two books sorted by the field date_of_publish in namespace db1.coll1"),
]);
