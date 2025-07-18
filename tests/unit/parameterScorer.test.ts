import { describe, expect, it } from "vitest";
import { DifferenceCreate } from "microdiff";
import { ParameterScorers, withParameterScorer, PARAMETER_SCORER_SYMBOL } from "../accuracy/sdk/parameterScorer.js";

describe("ParameterScorers", () => {
    describe("noAdditionsAllowedForPaths", () => {
        const scorer = ParameterScorers.noAdditionsAllowedForPaths(["filter", "query"]);

        it("should return 0.75 when no additions are made", () => {
            const additions: DifferenceCreate[] = [];
            expect(scorer(additions)).toBe(0.75);
        });

        it("should return 0.75 when additions are made to non-protected paths", () => {
            const additions: DifferenceCreate[] = [
                { type: "CREATE", path: ["limit"], value: 10 },
                { type: "CREATE", path: ["sort"], value: { name: 1 } },
            ];
            expect(scorer(additions)).toBe(0.75);
        });

        it("should return 0 when additions are made to protected top-level paths", () => {
            const additions: DifferenceCreate[] = [{ type: "CREATE", path: ["filter"], value: { name: "test" } }];
            expect(scorer(additions)).toBe(0);
        });

        it("should return 0 when additions are made to deeply nested protected paths", () => {
            const additions: DifferenceCreate[] = [{ type: "CREATE", path: ["filter", "age", "$gte"], value: 18 }];
            expect(scorer(additions)).toBe(0);
        });

        it("should handle array indices in paths correctly", () => {
            const additions: DifferenceCreate[] = [{ type: "CREATE", path: ["filter", "tags", 0], value: "new-tag" }];
            expect(scorer(additions)).toBe(0);
        });
    });

    describe("emptyAdditionsAllowedForPaths", () => {
        const scorer = ParameterScorers.emptyAdditionsAllowedForPaths(["filter", "options"]);

        it("should return 0.75 when no additions are made", () => {
            const additions: DifferenceCreate[] = [];
            expect(scorer(additions)).toBe(0.75);
        });

        it("should return 0.75 when empty object is added to protected path", () => {
            const additions: DifferenceCreate[] = [{ type: "CREATE", path: ["filter"], value: {} }];
            expect(scorer(additions)).toBe(0.75);
        });

        it("should return 0.75 when null is added to protected path", () => {
            const additions: DifferenceCreate[] = [{ type: "CREATE", path: ["filter"], value: null }];
            expect(scorer(additions)).toBe(0.75);
        });

        it("should return 0.75 when additions are made to non-protected paths", () => {
            const additions: DifferenceCreate[] = [
                { type: "CREATE", path: ["limit"], value: 10 },
                { type: "CREATE", path: ["sort"], value: { name: 1 } },
            ];
            expect(scorer(additions)).toBe(0.75);
        });

        it("should return 0 when non-empty object is added to protected path", () => {
            const additions: DifferenceCreate[] = [{ type: "CREATE", path: ["filter"], value: { name: "test" } }];
            expect(scorer(additions)).toBe(0);
        });

        it("should return 0 when non-empty additions are made to nested protected paths", () => {
            const additions: DifferenceCreate[] = [{ type: "CREATE", path: ["filter", "name"], value: "test" }];
            expect(scorer(additions)).toBe(0);
        });
    });
});

describe("withParameterScorer", () => {
    it("should attach scorer to parameters object", () => {
        const params = { database: "test", collection: "users" };
        const scorer = ParameterScorers.noAdditionsAllowedForPaths(["filter"]);

        const result = withParameterScorer(params, scorer);

        expect(result.database).toBe("test");
        expect(result.collection).toBe("users");
        expect(result[PARAMETER_SCORER_SYMBOL]).toBe(scorer);
    });
});
