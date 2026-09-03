import { describe, it, expect } from "vitest";
import { executionStatsToTreeData } from "./treeData.js";
import { ExplainPlan, type Stage } from "./ExplainPlan.js";

const classicExecutionStages = {
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
};

describe("executionStatsToTreeData", () => {
    it("returns undefined for missing execution stats or stages", () => {
        expect(executionStatsToTreeData(undefined)).toBeUndefined();
        expect(executionStatsToTreeData({})).toBeUndefined();
    });

    it("converts execution stages into tree data with timing roll-up", () => {
        const tree = executionStatsToTreeData({ executionStages: classicExecutionStages as Stage });

        expect(tree).toBeDefined();
        expect(tree?.name).toBe("FETCH");
        expect(tree?.id).toBe("stage-0");
        expect(tree?.nReturned).toBe(3);
        expect(tree?.curStageExecTimeMS).toBe(5);
        // prev = max of children's own stage times
        expect(tree?.prevStageExecTimeMS).toBe(2);

        expect(tree?.children).toHaveLength(1);
        const ixscan = tree?.children[0];
        expect(ixscan?.name).toBe("IXSCAN");
        expect(ixscan?.id).toBe("stage-1");
        expect(ixscan?.curStageExecTimeMS).toBe(2);
        expect(ixscan?.prevStageExecTimeMS).toBe(0);
    });

    it("omits child-stage keys from details", () => {
        const tree = executionStatsToTreeData({ executionStages: classicExecutionStages as Stage });
        expect(tree?.details.inputStage).toBeUndefined();
        expect(tree?.details.stage).toBe("FETCH");
    });

    it("extracts IXSCAN highlights", () => {
        const tree = executionStatsToTreeData({ executionStages: classicExecutionStages as Stage });
        expect(tree?.children[0]?.highlights).toEqual({
            "Index Name": "a_1",
            "Multi Key Index": false,
        });
    });

    it("extracts COLLSCAN highlights", () => {
        const tree = executionStatsToTreeData({
            executionStages: {
                stage: "COLLSCAN",
                nReturned: 10,
                executionTimeMillisEstimate: 1,
                docsExamined: 10,
            } as Stage,
        });
        expect(tree?.highlights).toEqual({ "Documents Examined": 10 });
    });

    it("marks shard nodes and defers their exec time to children", () => {
        const tree = executionStatsToTreeData({
            executionStages: {
                stage: "SHARD_MERGE",
                nReturned: 6,
                executionTimeMillis: 10,
                shards: [
                    {
                        shardName: "shard-0",
                        executionStages: {
                            stage: "COLLSCAN",
                            nReturned: 6,
                            executionTimeMillisEstimate: 4,
                            docsExamined: 10,
                        },
                    },
                ],
            } as unknown as Stage,
        });

        expect(tree?.name).toBe("SHARD_MERGE");
        expect(tree?.children).toHaveLength(1);
        const shard = tree?.children[0];
        expect(shard?.isShard).toBe(true);
        expect(shard?.name).toBe("shard-0");
        // shard cards inherit the max child time rather than reporting their own
        expect(shard?.curStageExecTimeMS).toBe(4);
        expect(shard?.children[0]?.name).toBe("COLLSCAN");
    });

    it("works end-to-end through ExplainPlan with parent stages attached", () => {
        const plan = new ExplainPlan({
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
                executionStages: classicExecutionStages,
            },
            ok: 1,
        } as Stage);

        expect(plan.namespace).toBe("db.coll");
        expect(plan.nReturned).toBe(3);
        expect(plan.isCollectionScan).toBe(false);
        expect(plan.usedIndexes).toEqual([{ index: "a_1", shard: null, fields: { a: 1 } }]);
        expect(plan.indexType).toBe("INDEX");

        const tree = executionStatsToTreeData(plan.executionStats);
        expect(tree?.name).toBe("FETCH");
        expect(tree?.children[0]?.name).toBe("IXSCAN");
    });
});
