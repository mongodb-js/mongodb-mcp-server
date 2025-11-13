import { describe, expect, it, vi } from "vitest";
import {
    assertVectorSearchFilterFieldsAreIndexed,
    collectFieldsFromVectorSearchFilter,
    type SearchIndex,
} from "../../../src/helpers/assertVectorSearchFilterFieldsAreIndexed.js";
import { ErrorCodes, MongoDBError } from "../../../src/common/errors.js";
import { type CompositeLogger, LogId } from "../../../src/common/logger.js";

describe("#collectFieldsFromVectorSearchFilter", () => {
    it("should return empty list if filter is not an object or an empty object", () => {
        expect(collectFieldsFromVectorSearchFilter(undefined)).toEqual([]);
        expect(collectFieldsFromVectorSearchFilter(null)).toEqual([]);
        expect(collectFieldsFromVectorSearchFilter(false)).toEqual([]);
        expect(collectFieldsFromVectorSearchFilter(true)).toEqual([]);
        expect(collectFieldsFromVectorSearchFilter(1)).toEqual([]);
        expect(collectFieldsFromVectorSearchFilter(0)).toEqual([]);
        expect(collectFieldsFromVectorSearchFilter("random")).toEqual([]);
        expect(collectFieldsFromVectorSearchFilter({})).toEqual([]);
        expect(collectFieldsFromVectorSearchFilter([])).toEqual([]);
        expect(collectFieldsFromVectorSearchFilter(() => {})).toEqual([]);
    });

    it("should return fields from MQL that does not contain logical operators", () => {
        expect(
            collectFieldsFromVectorSearchFilter({
                field1: "MongoDB",
                field2: { $eq: 1994 },
                field3: { $ne: "Horror" },
                field4: { $gt: 10 },
                field5: { $gt3: 10 },
                field6: { $lt: 10 },
                field7: { $lte: 10 },
                field8: { $in: [true, false] },
                field9: { $nin: [true, false] },
                field10: { $not: { $eq: 1994 } },
            })
        ).toEqual([
            "field1",
            "field2",
            "field3",
            "field4",
            "field5",
            "field6",
            "field7",
            "field8",
            "field9",
            "field10",
        ]);
    });

    it("should return fields from MQL built just with $and", () => {
        expect(
            collectFieldsFromVectorSearchFilter({
                $and: [
                    { field1: "MongoDB" },
                    { field2: { $eq: 1994 } },
                    { field3: { $ne: "Horror" } },
                    { field4: { $gt: 10 } },
                    { field5: { $gt3: 10 } },
                    { field6: { $lt: 10 } },
                    { field7: { $lte: 10 } },
                    { field8: { $in: [true, false] } },
                    { field9: { $nin: [true, false] } },
                    { field10: { $not: { $eq: 1994 } } },
                ],
            })
        ).toEqual([
            "field1",
            "field2",
            "field3",
            "field4",
            "field5",
            "field6",
            "field7",
            "field8",
            "field9",
            "field10",
        ]);
    });

    it("should return fields from MQL built just with $or", () => {
        expect(
            collectFieldsFromVectorSearchFilter({
                $or: [
                    { field1: "MongoDB" },
                    { field2: { $eq: 1994 } },
                    { field3: { $ne: "Horror" } },
                    { field4: { $gt: 10 } },
                    { field5: { $gt3: 10 } },
                    { field6: { $lt: 10 } },
                    { field7: { $lte: 10 } },
                    { field8: { $in: [true, false] } },
                    { field9: { $nin: [true, false] } },
                    { field10: { $not: { $eq: 1994 } } },
                ],
            })
        ).toEqual([
            "field1",
            "field2",
            "field3",
            "field4",
            "field5",
            "field6",
            "field7",
            "field8",
            "field9",
            "field10",
        ]);
    });

    it("should return fields from MQL built with nested $and / $or", () => {
        expect(
            collectFieldsFromVectorSearchFilter({
                $or: [
                    { field1: "MongoDB" },
                    { field2: { $eq: 1994 } },
                    { field3: { $ne: "Horror" } },
                    { field4: { $gt: 10 } },
                    { field5: { $gt3: 10 } },
                    { field6: { $lt: 10 } },
                    {
                        $and: [
                            { field7: { $lte: 10 } },
                            { field8: { $in: [true, false] } },
                            { field9: { $nin: [true, false] } },
                            { field10: { $not: { $eq: 1994 } } },
                        ],
                    },
                ],
            })
        ).toEqual([
            "field1",
            "field2",
            "field3",
            "field4",
            "field5",
            "field6",
            "field7",
            "field8",
            "field9",
            "field10",
        ]);

        expect(
            collectFieldsFromVectorSearchFilter({
                $and: [
                    { field1: "MongoDB" },
                    { field2: { $eq: 1994 } },
                    { field3: { $ne: "Horror" } },
                    { field4: { $gt: 10 } },
                    { field5: { $gt3: 10 } },
                    { field6: { $lt: 10 } },
                    {
                        $or: [
                            { field7: { $lte: 10 } },
                            { field8: { $in: [true, false] } },
                            { field9: { $nin: [true, false] } },
                            { field10: { $not: { $eq: 1994 } } },
                        ],
                    },
                ],
            })
        ).toEqual([
            "field1",
            "field2",
            "field3",
            "field4",
            "field5",
            "field6",
            "field7",
            "field8",
            "field9",
            "field10",
        ]);
    });
});

describe("#assertVectorSearchFilterFieldsAreIndexed", () => {
    const mockLogger = {
        debug: vi.fn(),
        info: vi.fn(),
        warning: vi.fn(),
        error: vi.fn(),
    } as unknown as CompositeLogger;

    const createMockSearchIndexes = (indexName: string, filterFields: string[]): SearchIndex[] => [
        {
            name: indexName,
            latestDefinition: {
                fields: [
                    { type: "vector" as const },
                    ...filterFields.map((field) => ({
                        type: "filter" as const,
                        path: field,
                    })),
                ],
            },
            type: "vectorSearch",
        },
    ];

    it("should not throw when all filter fields are indexed", () => {
        const searchIndexes = createMockSearchIndexes("myIndex", ["field1", "field2", "field3"]);
        const pipeline = [
            {
                $vectorSearch: {
                    index: "myIndex",
                    path: "embedding",
                    queryVector: [1, 2, 3],
                    numCandidates: 100,
                    limit: 10,
                    filter: {
                        field1: "value",
                        field2: { $eq: 10 },
                    },
                },
            },
        ];

        expect(() =>
            assertVectorSearchFilterFieldsAreIndexed({
                searchIndexes,
                pipeline,
                logger: mockLogger,
            })
        ).not.toThrow();
    });

    it("should not throw when filter is empty", () => {
        const searchIndexes = createMockSearchIndexes("myIndex", ["field1"]);
        const pipeline = [
            {
                $vectorSearch: {
                    index: "myIndex",
                    path: "embedding",
                    queryVector: [1, 2, 3],
                    numCandidates: 100,
                    limit: 10,
                    filter: {},
                },
            },
        ];

        expect(() =>
            assertVectorSearchFilterFieldsAreIndexed({
                searchIndexes,
                pipeline,
                logger: mockLogger,
            })
        ).not.toThrow();
    });

    it("should not throw when filter is not provided", () => {
        const searchIndexes = createMockSearchIndexes("myIndex", ["field1"]);
        const pipeline = [
            {
                $vectorSearch: {
                    index: "myIndex",
                    path: "embedding",
                    queryVector: [1, 2, 3],
                    numCandidates: 100,
                    limit: 10,
                },
            },
        ];

        expect(() =>
            assertVectorSearchFilterFieldsAreIndexed({
                searchIndexes,
                pipeline,
                logger: mockLogger,
            })
        ).not.toThrow();
    });

    it("should not throw when pipeline has no $vectorSearch stage", () => {
        const searchIndexes = createMockSearchIndexes("myIndex", ["field1"]);
        const pipeline = [{ $match: { status: "active" } }, { $limit: 10 }];

        expect(() =>
            assertVectorSearchFilterFieldsAreIndexed({
                searchIndexes,
                pipeline,
                logger: mockLogger,
            })
        ).not.toThrow();
    });

    it("should throw MongoDBError when filter field is not indexed", () => {
        const searchIndexes = createMockSearchIndexes("myIndex", ["field1", "field2"]);
        const pipeline = [
            {
                $vectorSearch: {
                    index: "myIndex",
                    path: "embedding",
                    queryVector: [1, 2, 3],
                    numCandidates: 100,
                    limit: 10,
                    filter: {
                        field1: "value",
                        field3: { $eq: 10 }, // field3 is not indexed
                    },
                },
            },
        ];

        expect(() =>
            assertVectorSearchFilterFieldsAreIndexed({
                searchIndexes,
                pipeline,
                logger: mockLogger,
            })
        ).toThrow(MongoDBError);

        expect(() =>
            assertVectorSearchFilterFieldsAreIndexed({
                searchIndexes,
                pipeline,
                logger: mockLogger,
            })
        ).toThrow(
            new MongoDBError(
                ErrorCodes.AtlasVectorSearchInvalidQuery,
                "Vector search stage contains filter on fields that are not indexed by index myIndex - field3"
            )
        );
    });

    it("should throw MongoDBError with all unindexed fields listed", () => {
        const searchIndexes = createMockSearchIndexes("myIndex", ["field1"]);
        const pipeline = [
            {
                $vectorSearch: {
                    index: "myIndex",
                    path: "embedding",
                    queryVector: [1, 2, 3],
                    numCandidates: 100,
                    limit: 10,
                    filter: {
                        field1: "value",
                        field2: { $eq: 10 },
                        field3: { $gt: 5 },
                    },
                },
            },
        ];

        expect(() =>
            assertVectorSearchFilterFieldsAreIndexed({
                searchIndexes,
                pipeline,
                logger: mockLogger,
            })
        ).toThrow(
            new MongoDBError(
                ErrorCodes.AtlasVectorSearchInvalidQuery,
                "Vector search stage contains filter on fields that are not indexed by index myIndex - field2, field3"
            )
        );
    });

    it("should handle nested $and and $or operators", () => {
        const searchIndexes = createMockSearchIndexes("myIndex", ["field1", "field2", "field3"]);
        const pipeline = [
            {
                $vectorSearch: {
                    index: "myIndex",
                    path: "embedding",
                    queryVector: [1, 2, 3],
                    numCandidates: 100,
                    limit: 10,
                    filter: {
                        $or: [
                            { field1: "value" },
                            {
                                $and: [{ field2: { $eq: 10 } }, { field3: { $gt: 5 } }],
                            },
                        ],
                    },
                },
            },
        ];

        expect(() =>
            assertVectorSearchFilterFieldsAreIndexed({
                searchIndexes,
                pipeline,
                logger: mockLogger,
            })
        ).not.toThrow();
    });

    it("should throw when nested filter contains unindexed field", () => {
        const searchIndexes = createMockSearchIndexes("myIndex", ["field1", "field2"]);
        const pipeline = [
            {
                $vectorSearch: {
                    index: "myIndex",
                    path: "embedding",
                    queryVector: [1, 2, 3],
                    numCandidates: 100,
                    limit: 10,
                    filter: {
                        $or: [
                            { field1: "value" },
                            {
                                $and: [{ field2: { $eq: 10 } }, { field4: { $gt: 5 } }], // field4 not indexed
                            },
                        ],
                    },
                },
            },
        ];

        expect(() =>
            assertVectorSearchFilterFieldsAreIndexed({
                searchIndexes,
                pipeline,
                logger: mockLogger,
            })
        ).toThrow(
            new MongoDBError(
                ErrorCodes.AtlasVectorSearchInvalidQuery,
                "Vector search stage contains filter on fields that are not indexed by index myIndex - field4"
            )
        );
    });

    it("should log warning when index is not found in searchIndexes", () => {
        const searchIndexes = createMockSearchIndexes("myIndex", ["field1"]);
        const pipeline = [
            {
                $vectorSearch: {
                    index: "nonExistentIndex",
                    path: "embedding",
                    queryVector: [1, 2, 3],
                    numCandidates: 100,
                    limit: 10,
                    filter: {
                        field1: "value",
                    },
                },
            },
        ];

        assertVectorSearchFilterFieldsAreIndexed({
            searchIndexes,
            pipeline,
            logger: mockLogger,
        });

        // eslint-disable-next-line @typescript-eslint/unbound-method
        expect(mockLogger.warning).toHaveBeenCalledWith({
            id: LogId.toolValidationError,
            context: "aggregate tool",
            message:
                "Could not assert if filter fields are indexed - No filter fields found for index nonExistentIndex",
        });
    });

    it("should handle multiple $vectorSearch stages in pipeline", () => {
        const searchIndexes = [
            ...createMockSearchIndexes("index1", ["field1", "field2"]),
            ...createMockSearchIndexes("index2", ["field3", "field4"]),
        ];
        const pipeline = [
            {
                $vectorSearch: {
                    index: "index1",
                    path: "embedding",
                    queryVector: [1, 2, 3],
                    numCandidates: 100,
                    limit: 10,
                    filter: {
                        field1: "value",
                    },
                },
            },
            { $limit: 5 },
            {
                $vectorSearch: {
                    index: "index2",
                    path: "embedding2",
                    queryVector: [4, 5, 6],
                    numCandidates: 50,
                    limit: 5,
                    filter: {
                        field3: "value2",
                    },
                },
            },
        ];

        expect(() =>
            assertVectorSearchFilterFieldsAreIndexed({
                searchIndexes,
                pipeline,
                logger: mockLogger,
            })
        ).not.toThrow();
    });

    it("should throw on second $vectorSearch stage if it has unindexed field", () => {
        const searchIndexes = [
            ...createMockSearchIndexes("index1", ["field1", "field2"]),
            ...createMockSearchIndexes("index2", ["field3"]),
        ];
        const pipeline = [
            {
                $vectorSearch: {
                    index: "index1",
                    path: "embedding",
                    queryVector: [1, 2, 3],
                    numCandidates: 100,
                    limit: 10,
                    filter: {
                        field1: "value",
                    },
                },
            },
            {
                $vectorSearch: {
                    index: "index2",
                    path: "embedding2",
                    queryVector: [4, 5, 6],
                    numCandidates: 50,
                    limit: 5,
                    filter: {
                        field4: "value2", // field4 not indexed in index2
                    },
                },
            },
        ];

        expect(() =>
            assertVectorSearchFilterFieldsAreIndexed({
                searchIndexes,
                pipeline,
                logger: mockLogger,
            })
        ).toThrow(
            new MongoDBError(
                ErrorCodes.AtlasVectorSearchInvalidQuery,
                "Vector search stage contains filter on fields that are not indexed by index index2 - field4"
            )
        );
    });

    it("should handle search index with no filter fields", () => {
        const searchIndexes: SearchIndex[] = [
            {
                name: "myIndex",
                latestDefinition: {
                    fields: [{ type: "vector" }],
                },
                type: "vectorSearch",
            },
        ];
        const pipeline = [
            {
                $vectorSearch: {
                    index: "myIndex",
                    path: "embedding",
                    queryVector: [1, 2, 3],
                    numCandidates: 100,
                    limit: 10,
                    filter: {
                        field1: "value",
                    },
                },
            },
        ];

        expect(() =>
            assertVectorSearchFilterFieldsAreIndexed({
                searchIndexes,
                pipeline,
                logger: mockLogger,
            })
        ).toThrow(
            new MongoDBError(
                ErrorCodes.AtlasVectorSearchInvalidQuery,
                "Vector search stage contains filter on fields that are not indexed by index myIndex - field1"
            )
        );
    });

    it("should ignore atlas search indexes", () => {
        const searchIndexes: SearchIndex[] = [
            ...createMockSearchIndexes("index1", ["field1", "field2"]),
            // Atlas search index - it should be ignored by the validation
            // and not cause any errors
            {
                name: "atlasSearchIndex",
                latestDefinition: {
                    analyzer: "lucene.standard",
                    mappings: {
                        dynamic: false,
                    },
                },
                type: "search",
            },
        ];

        const pipeline = [
            {
                $vectorSearch: {
                    index: "index1",
                    path: "embedding",
                    queryVector: [1, 2, 3],
                    numCandidates: 100,
                    limit: 10,
                    filter: {
                        field1: "value",
                    },
                },
            },
        ];

        expect(() =>
            assertVectorSearchFilterFieldsAreIndexed({
                searchIndexes: searchIndexes,
                pipeline,
                logger: mockLogger,
            })
        ).not.toThrow();
    });
});
