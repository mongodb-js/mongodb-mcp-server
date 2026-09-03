import { describe, it, expect } from "vitest";
import { convertExplain, isAggregationExplain, isShardedFindExplain } from "./explainCompat.js";

/** Classic-engine find explain (no explainVersion) with executionStats. */
const classicFindExplain = {
    queryPlanner: {
        namespace: "db.coll",
        parsedQuery: { a: { $eq: 1 } },
        winningPlan: {
            stage: "FETCH",
            inputStage: { stage: "IXSCAN", indexName: "a_1", keyPattern: { a: 1 } },
        },
    },
    executionStats: {
        executionSuccess: true,
        nReturned: 3,
        executionTimeMillis: 5,
        totalKeysExamined: 3,
        totalDocsExamined: 3,
        executionStages: {
            stage: "FETCH",
            nReturned: 3,
            executionTimeMillisEstimate: 5,
            docsExamined: 3,
            inputStage: {
                stage: "IXSCAN",
                indexName: "a_1",
                keyPattern: { a: 1 },
                isMultiKey: false,
                nReturned: 3,
                executionTimeMillisEstimate: 2,
                keysExamined: 3,
                docsExamined: 3,
            },
        },
    },
    ok: 1,
};

/** SBE find explain: queryPlan wrapper + lowercase SBE execution stages. */
const sbeFindExplain = {
    explainVersion: "2",
    queryPlanner: {
        namespace: "db.coll",
        parsedQuery: { a: { $eq: 1 } },
        winningPlan: {
            queryPlan: {
                stage: "FETCH",
                planNodeId: 1,
                inputStage: { stage: "IXSCAN", planNodeId: 2, indexName: "a_1", keyPattern: { a: 1 } },
            },
        },
    },
    executionStats: {
        executionSuccess: true,
        nReturned: 3,
        executionTimeMillis: 5,
        totalKeysExamined: 3,
        totalDocsExamined: 3,
        executionStages: {
            stage: "fetch",
            planNodeId: 1,
            nReturned: 3,
            executionTimeMillis: 5,
            inputStage: { stage: "ixseek", planNodeId: 2, nReturned: 3, numReads: 3, executionTimeMillis: 2 },
        },
    },
    ok: 1,
};

/** Unsharded aggregation explain (SBE): pipeline stages with a leading $cursor. */
const sbeAggregationExplain = {
    explainVersion: "2",
    stages: [
        {
            $cursor: {
                queryPlanner: {
                    namespace: "db.coll",
                    parsedQuery: {},
                    winningPlan: {
                        queryPlan: { stage: "COLLSCAN", planNodeId: 1, direction: "forward" },
                    },
                },
                executionStats: {
                    executionSuccess: true,
                    nReturned: 10,
                    executionTimeMillis: 1,
                    totalKeysExamined: 0,
                    totalDocsExamined: 10,
                    executionStages: {
                        stage: "scan",
                        planNodeId: 1,
                        nReturned: 10,
                        numReads: 10,
                        executionTimeMillis: 1,
                    },
                },
            },
        },
        { $_internalInhibitOptimization: {} },
    ],
    ok: 1,
};

describe("explainCompat", () => {
    describe("convertExplain", () => {
        it("passes classic explains through unchanged", () => {
            const result = convertExplain(classicFindExplain);

            expect(result.queryPlanner.winningPlan.stage).toBe("FETCH");
            expect(result.queryPlanner.winningPlan.inputStage.stage).toBe("IXSCAN");
            expect(result.executionStats.executionStages.stage).toBe("FETCH");
        });

        it("unwraps SBE queryPlan onto winningPlan and maps SBE execution stages onto classic nodes", () => {
            const result = convertExplain(sbeFindExplain);

            expect(result.explainVersion).toBeUndefined();
            expect(result.queryPlanner.winningPlan.stage).toBe("FETCH");
            expect(result.queryPlanner.winningPlan.queryPlan).toBeUndefined();

            const stages = result.executionStats.executionStages;
            expect(stages.stage).toBe("FETCH");
            expect(stages.executionTimeMillisEstimate).toBe(5);
            expect(stages.inputStage.stage).toBe("IXSCAN");
            // numReads from the SBE ixseek node becomes keysExamined
            expect(stages.inputStage.keysExamined).toBe(3);
            // indexName survives from the classic query plan node
            expect(stages.inputStage.indexName).toBe("a_1");
        });

        it("maps SBE aggregation cursor stages to classic shape", () => {
            const result = convertExplain(sbeAggregationExplain);

            const cursor = result.stages[0].$cursor;
            expect(cursor.queryPlanner.winningPlan.stage).toBe("COLLSCAN");
            expect(cursor.executionStats.executionStages.stage).toBe("COLLSCAN");
            // numReads from the SBE scan node becomes docsExamined
            expect(cursor.executionStats.executionStages.docsExamined).toBe(10);
        });
    });

    describe("predicates", () => {
        it("detects aggregation explains by the stages property", () => {
            expect(isAggregationExplain(sbeAggregationExplain)).toBe(true);
            expect(isAggregationExplain(classicFindExplain)).toBe(false);
        });

        it("detects sharded find explains via mongosPlannerVersion", () => {
            expect(isShardedFindExplain(classicFindExplain)).toBe(false);
            expect(
                isShardedFindExplain({
                    queryPlanner: { mongosPlannerVersion: 1, winningPlan: { shards: [] } },
                })
            ).toBe(true);
        });
    });
});
