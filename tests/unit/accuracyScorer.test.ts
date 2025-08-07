import { describe, expect, it } from "vitest";
import { calculateToolCallingAccuracy } from "../accuracy/sdk/accuracyScorer.js";
import { ExpectedToolCall, LLMToolCall } from "../accuracy/sdk/accuracyResultStorage/resultStorage.js";
import { Matcher } from "../accuracy/sdk/matcher.js";

describe("calculateToolCallingAccuracy", () => {
    describe("edge cases", () => {
        it("should return 1 when both expected and actual are empty", () => {
            const result = calculateToolCallingAccuracy([], []);
            expect(result).toBe(1);
        });

        it("should return 0.75 when expected is empty but actual has tool calls", () => {
            const actualToolCalls: LLMToolCall[] = [{ toolCallId: "1", toolName: "find", parameters: { db: "test" } }];
            const result = calculateToolCallingAccuracy([], actualToolCalls);
            expect(result).toBe(0.75);
        });

        it("should return 0 when expected has tool calls but actual is empty", () => {
            const expectedToolCalls: ExpectedToolCall[] = [{ toolName: "find", parameters: { db: "test" } }];
            const result = calculateToolCallingAccuracy(expectedToolCalls, []);
            expect(result).toBe(0);
        });
    });

    describe("perfect matches", () => {
        it("should return 1 for exact match with nested parameters", () => {
            const expected: ExpectedToolCall[] = [
                {
                    toolName: "find",
                    parameters: { db: "test", collection: "users", filter: { age: { $gte: 18 }, status: "active" } },
                },
            ];
            const actual: LLMToolCall[] = [
                {
                    toolCallId: "1",
                    toolName: "find",
                    parameters: { db: "test", collection: "users", filter: { age: { $gte: 18 }, status: "active" } },
                },
            ];
            const result = calculateToolCallingAccuracy(expected, actual);
            expect(result).toBe(1);
        });

        it("should return 1 for exact match with multiple diverse tool calls", () => {
            const expected: ExpectedToolCall[] = [
                { toolName: "find", parameters: { db: "test", collection: "users", filter: { status: "active" } } },
                {
                    toolName: "aggregate",
                    parameters: { db: "test", collection: "orders", pipeline: [{ $match: { total: { $gt: 100 } } }] },
                },
                { toolName: "count", parameters: { db: "test", collection: "products" } },
            ];
            const actual: LLMToolCall[] = [
                {
                    toolCallId: "1",
                    toolName: "find",
                    parameters: { db: "test", collection: "users", filter: { status: "active" } },
                },
                {
                    toolCallId: "2",
                    toolName: "aggregate",
                    parameters: { db: "test", collection: "orders", pipeline: [{ $match: { total: { $gt: 100 } } }] },
                },
                { toolCallId: "3", toolName: "count", parameters: { db: "test", collection: "products" } },
            ];
            const result = calculateToolCallingAccuracy(expected, actual);
            expect(result).toBe(1);
        });
    });

    describe("additional parameters", () => {
        it("should return 0 when tool call has additional nested parameters (default behavior)", () => {
            const expected: ExpectedToolCall[] = [
                { toolName: "find", parameters: { db: "test", collection: "users", filter: { status: "active" } } },
            ];
            const actual: LLMToolCall[] = [
                {
                    toolCallId: "1",
                    toolName: "find",
                    parameters: {
                        db: "test",
                        collection: "users",
                        filter: { status: "active", age: { $gte: 18 } },
                        limit: 10,
                    },
                },
            ];
            const result = calculateToolCallingAccuracy(expected, actual);
            expect(result).toBe(0);
        });

        it("should return 1 when expected has no filter but actual has empty filter", () => {
            const expected: ExpectedToolCall[] = [
                {
                    toolName: "find",
                    parameters: {
                        database: "mflix",
                        collection: "movies",
                        filter: Matcher.emptyObjectOrUndefined,
                    },
                },
            ];
            const actual: LLMToolCall[] = [
                {
                    toolCallId: "1",
                    toolName: "find",
                    parameters: {
                        database: "mflix",
                        collection: "movies",
                        filter: {},
                    },
                },
            ];
            const result = calculateToolCallingAccuracy(expected, actual);
            expect(result).toBe(1);
        });

        it("should return 1 when expected has no filter and actual has no filter", () => {
            const expected: ExpectedToolCall[] = [
                {
                    toolName: "find",
                    parameters: {
                        database: "mflix",
                        collection: "movies",
                        filter: Matcher.emptyObjectOrUndefined,
                    },
                },
            ];
            const actual: LLMToolCall[] = [
                {
                    toolCallId: "1",
                    toolName: "find",
                    parameters: {
                        database: "mflix",
                        collection: "movies",
                    },
                },
            ];
            const result = calculateToolCallingAccuracy(expected, actual);
            expect(result).toBe(1);
        });

        it("should return 0 when expected has no filter but actual has non-empty filter", () => {
            const expected: ExpectedToolCall[] = [
                {
                    toolName: "find",
                    parameters: {
                        database: "mflix",
                        collection: "movies",
                        filter: Matcher.emptyObjectOrUndefined,
                    },
                },
            ];
            const actual: LLMToolCall[] = [
                {
                    toolCallId: "1",
                    toolName: "find",
                    parameters: {
                        database: "mflix",
                        collection: "movies",
                        filter: { genre: "Horror" },
                    },
                },
            ];
            const result = calculateToolCallingAccuracy(expected, actual);
            expect(result).toBe(0);
        });

        it("should return 0 when there are additional nested fields", () => {
            const expected: ExpectedToolCall[] = [
                {
                    toolName: "find",
                    parameters: {
                        database: "mflix",
                        collection: "movies",
                        filter: { runtime: { $lt: 100 } },
                    },
                },
            ];
            const actual: LLMToolCall[] = [
                {
                    toolCallId: "1",
                    toolName: "find",
                    parameters: {
                        database: "mflix",
                        collection: "movies",
                        filter: { runtime: { $lt: 100 }, genre: "Horror" },
                    },
                },
            ];
            const result = calculateToolCallingAccuracy(expected, actual);
            expect(result).toBe(0);
        });

        it("should return 1 when ignored additional fields are provided", () => {
            const expected: ExpectedToolCall[] = [
                {
                    toolName: "find",
                    parameters: {
                        database: "mflix",
                        collection: "movies",
                        filter: { runtime: { $lt: 100 } },
                        limit: Matcher.number(),
                        sort: Matcher.anyValue,
                    },
                },
            ];
            const actual: LLMToolCall[] = [
                {
                    toolCallId: "1",
                    toolName: "find",
                    parameters: {
                        database: "mflix",
                        collection: "movies",
                        filter: { runtime: { $lt: 100 } },
                        limit: 10,
                        sort: { title: 1 },
                    },
                },
            ];
            const result = calculateToolCallingAccuracy(expected, actual);
            expect(result).toBe(1);
        });

        it("should return 1 for array where additional elements are allowed", () => {
            const expected: ExpectedToolCall[] = [
                {
                    toolName: "aggregate",
                    parameters: {
                        database: "mflix",
                        collection: "movies",
                        pipeline: [{ $match: { genre: "Horror" } }, Matcher.anyOf(Matcher.undefined, Matcher.anyValue)],
                    },
                },
            ];

            const actual: LLMToolCall[] = [
                {
                    toolCallId: "1",
                    toolName: "aggregate",
                    parameters: {
                        database: "mflix",
                        collection: "movies",
                        pipeline: [{ $match: { genre: "Horror" } }, { $sort: { title: 1 } }],
                    },
                },
            ];

            const result = calculateToolCallingAccuracy(expected, actual);
            expect(result).toBe(1);
        });

        it("should return 1 for array where additional elements are allowed but not provided", () => {
            const expected: ExpectedToolCall[] = [
                {
                    toolName: "aggregate",
                    parameters: {
                        database: "mflix",
                        collection: "movies",
                        pipeline: [{ $match: { genre: "Horror" } }, Matcher.anyOf(Matcher.undefined, Matcher.anyValue)],
                    },
                },
            ];

            const actual: LLMToolCall[] = [
                {
                    toolCallId: "1",
                    toolName: "aggregate",
                    parameters: {
                        database: "mflix",
                        collection: "movies",
                        pipeline: [{ $match: { genre: "Horror" } }],
                    },
                },
            ];

            const result = calculateToolCallingAccuracy(expected, actual);
            expect(result).toBe(1);
        });
    });

    describe("missing or incorrect parameters", () => {
        it("should return 0 when tool call has missing nested parameters", () => {
            const expected: ExpectedToolCall[] = [
                {
                    toolName: "find",
                    parameters: { db: "test", collection: "users", filter: { status: "active", age: { $gte: 18 } } },
                },
            ];
            const actual: LLMToolCall[] = [
                {
                    toolCallId: "1",
                    toolName: "find",
                    parameters: { db: "test", collection: "users", filter: { status: "active" } },
                },
            ];
            const result = calculateToolCallingAccuracy(expected, actual);
            expect(result).toBe(0);
        });

        it("should return 0 when aggregate tool call has incorrect pipeline", () => {
            const expected: ExpectedToolCall[] = [
                {
                    toolName: "aggregate",
                    parameters: { db: "test", collection: "orders", pipeline: [{ $match: { total: { $gt: 100 } } }] },
                },
            ];
            const actual: LLMToolCall[] = [
                {
                    toolCallId: "1",
                    toolName: "aggregate",
                    parameters: { db: "test", collection: "orders", pipeline: [{ $match: { total: { $lt: 50 } } }] },
                },
            ];
            const result = calculateToolCallingAccuracy(expected, actual);
            expect(result).toBe(0);
        });
    });

    describe("additional tool calls", () => {
        it("should cap accuracy at 0.75 when LLM calls extra tools", () => {
            const expected: ExpectedToolCall[] = [
                { toolName: "find", parameters: { db: "test", collection: "users", filter: { status: "active" } } },
            ];
            const actual: LLMToolCall[] = [
                {
                    toolCallId: "1",
                    toolName: "find",
                    parameters: { db: "test", collection: "users", filter: { status: "active" } },
                },
                { toolCallId: "2", toolName: "count", parameters: { db: "test", collection: "orders" } },
                {
                    toolCallId: "3",
                    toolName: "aggregate",
                    parameters: {
                        db: "test",
                        collection: "products",
                        pipeline: [{ $group: { _id: "$category", total: { $sum: 1 } } }],
                    },
                },
            ];
            const result = calculateToolCallingAccuracy(expected, actual);
            expect(result).toBe(0.75);
        });

        it("should cap accuracy at 0.75 when LLM calls same tool multiple times with variations", () => {
            const expected: ExpectedToolCall[] = [
                { toolName: "find", parameters: { db: "test", collection: "users", filter: { status: "active" } } },
            ];
            const actual: LLMToolCall[] = [
                {
                    toolCallId: "1",
                    toolName: "find",
                    parameters: { db: "test", collection: "users", filter: { status: "active" } },
                },
                {
                    toolCallId: "2",
                    toolName: "find",
                    parameters: { db: "test", collection: "users", filter: { status: "active", age: { $gte: 18 } } },
                },
                { toolCallId: "3", toolName: "find", parameters: { db: "test", collection: "users", limit: 10 } },
            ];
            const result = calculateToolCallingAccuracy(expected, actual);
            expect(result).toBe(0.75);
        });
    });

    describe("missing tool calls", () => {
        it("should return 0 if any expected tool call was not called", () => {
            const expected: ExpectedToolCall[] = [
                { toolName: "find", parameters: { db: "test", collection: "users", filter: { status: "active" } } },
                {
                    toolName: "aggregate",
                    parameters: { db: "test", collection: "orders", pipeline: [{ $match: { total: { $gt: 100 } } }] },
                },
            ];
            const actual: LLMToolCall[] = [
                {
                    toolCallId: "1",
                    toolName: "find",
                    parameters: { db: "test", collection: "users", filter: { status: "active" } },
                },
                // Missing the aggregate tool call
            ];
            const result = calculateToolCallingAccuracy(expected, actual);
            expect(result).toBe(0); // One expected tool call was not called
        });
    });
});
