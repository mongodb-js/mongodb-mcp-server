import { describe, it, expect } from "vitest";
import { assertNoServerSideJS, getWriteStageTargets, isWriteStage } from "../../../src/helpers/mqlGuards.js";
import { ErrorCodes, MongoDBError } from "../../../src/common/errors.js";

function expectForbiddenOperator(value: unknown, operator: string): void {
    try {
        assertNoServerSideJS(value);
        expect.unreachable(`Expected assertNoServerSideJS to throw for ${operator}`);
    } catch (error) {
        expect(error).toBeInstanceOf(MongoDBError);
        expect((error as MongoDBError).code).toBe(ErrorCodes.ForbiddenServerSideJS);
        expect((error as MongoDBError).message).toContain(`The "${operator}" operator is not allowed.`);
    }
}

describe("mqlGuards", () => {
    describe("assertNoServerSideJS", () => {
        it("does not throw when no server-side JavaScript operator is present", () => {
            expect(() =>
                assertNoServerSideJS([{ $match: { age: { $gt: 8 } } }, { $sort: { name: -1 } }])
            ).not.toThrow();
            expect(() => assertNoServerSideJS({ name: "Peter", nested: { values: [1, 2, 3] } })).not.toThrow();
            expect(() => assertNoServerSideJS(null)).not.toThrow();
            expect(() => assertNoServerSideJS("just a string")).not.toThrow();
        });

        it("throws a MongoDBError with the ForbiddenServerSideJS code for $where in a query filter", () => {
            expectForbiddenOperator({ $where: "function() { return true; }" }, "$where");
        });

        it("detects operators nested deep inside a pipeline", () => {
            const pipeline = [
                { $match: { age: { $gt: 8 } } },
                {
                    $project: {
                        doubled: {
                            $function: { body: "function(x) { return x * 2; }", args: ["$age"], lang: "js" },
                        },
                    },
                },
            ];
            expectForbiddenOperator(pipeline, "$function");
        });

        it("detects $accumulator inside arrays of stages", () => {
            const pipeline = [
                {
                    $group: {
                        _id: null,
                        total: {
                            $accumulator: {
                                init: "function() { return 0; }",
                                accumulate: "function(s, v) { return s + v; }",
                                accumulateArgs: ["$age"],
                                merge: "function(a, b) { return a + b; }",
                                lang: "js",
                            },
                        },
                    },
                },
            ];
            expectForbiddenOperator(pipeline, "$accumulator");
        });

        it("detects every documented server-side JavaScript operator", () => {
            for (const operator of ["$where", "$function", "$accumulator"]) {
                expectForbiddenOperator({ [operator]: "anything" }, operator);
            }
        });
    });

    describe("isWriteStage", () => {
        it("returns true for $out and $merge stages", () => {
            expect(isWriteStage({ $out: "results" })).toBe(true);
            expect(isWriteStage({ $merge: { into: "results" } })).toBe(true);
        });

        it("returns false for read-only stages", () => {
            expect(isWriteStage({ $match: { age: 5 } })).toBe(false);
            expect(isWriteStage({ $group: { _id: null } })).toBe(false);
            expect(isWriteStage({})).toBe(false);
        });
    });

    describe("getWriteStageTargets", () => {
        it("returns an empty array for pipelines without write stages", () => {
            expect(getWriteStageTargets([{ $match: { age: 5 } }, { $sort: { name: 1 } }], "mydb")).toEqual([]);
        });

        it("resolves a $out stage naming a collection against the default database", () => {
            expect(getWriteStageTargets([{ $out: "results" }], "mydb")).toEqual([
                { operator: "$out", namespace: "mydb.results" },
            ]);
        });

        it("resolves a $out stage naming an explicit database and collection", () => {
            expect(getWriteStageTargets([{ $out: { db: "otherdb", coll: "results" } }], "mydb")).toEqual([
                { operator: "$out", namespace: "otherdb.results" },
            ]);
        });

        it("resolves a $merge stage naming a collection against the default database", () => {
            expect(getWriteStageTargets([{ $merge: "results" }], "mydb")).toEqual([
                { operator: "$merge", namespace: "mydb.results" },
            ]);
        });

        it("resolves a $merge stage with an into string", () => {
            expect(getWriteStageTargets([{ $merge: { into: "results" } }], "mydb")).toEqual([
                { operator: "$merge", namespace: "mydb.results" },
            ]);
        });

        it("resolves a $merge stage with an into document naming an explicit database", () => {
            expect(getWriteStageTargets([{ $merge: { into: { db: "otherdb", coll: "results" } } }], "mydb")).toEqual([
                { operator: "$merge", namespace: "otherdb.results" },
            ]);
        });

        it("reports the whenMatched and whenNotMatched behaviours of a $merge stage", () => {
            expect(
                getWriteStageTargets(
                    [{ $merge: { into: "results", whenMatched: "replace", whenNotMatched: "discard" } }],
                    "mydb"
                )
            ).toEqual([
                { operator: "$merge", namespace: "mydb.results", whenMatched: "replace", whenNotMatched: "discard" },
            ]);
        });

        it("omits a whenMatched that is a custom pipeline rather than a documented mode", () => {
            expect(
                getWriteStageTargets([{ $merge: { into: "results", whenMatched: [{ $set: { seen: true } }] } }], "mydb")
            ).toEqual([{ operator: "$merge", namespace: "mydb.results" }]);
        });

        it("leaves the namespace undefined for unrecognised write stage shapes", () => {
            expect(getWriteStageTargets([{ $out: { s3: { bucket: "b", region: "us-east-1" } } }], "mydb")).toEqual([
                { operator: "$out", namespace: undefined },
            ]);
            expect(getWriteStageTargets([{ $merge: { into: { s3: "bucket" } } }], "mydb")).toEqual([
                { operator: "$merge", namespace: undefined },
            ]);
        });

        it("only inspects top-level stages", () => {
            expect(getWriteStageTargets([{ $unionWith: { pipeline: [{ $out: "results" }] } }], "mydb")).toEqual([]);
        });
    });
});
