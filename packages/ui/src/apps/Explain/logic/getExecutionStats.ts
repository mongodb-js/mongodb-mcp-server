/**
 * Portions ported from mongodb/compass @ adad060c5e
 * Source: packages/explain-plan-helper/src/get-execution-stats.ts
 * Copyright MongoDB, Inc. Original license: SSPL-1.0 (MongoDB-internal reuse).
 */
import { isAggregationExplain, isShardedAggregationExplain, getStageCursorKey } from "./explainCompat.js";

import type { Stage, IndexInformation } from "./ExplainPlan.js";

export type ExecutionStats = Partial<{
    executionSuccess: boolean;
    nReturned: number;
    executionTimeMillis: number;
    totalKeysExamined: number;
    totalDocsExamined: number;
    executionStages: Stage;
    allPlansExecution: unknown[];
    stageIndexes: IndexInformation[];
}>;

export const getExecutionStats = (explain: Stage): ExecutionStats | undefined => {
    const executionStats = isAggregationExplain(explain) ? getAggregationStats(explain) : getFindStats(explain);
    return executionStats;
};
const getAggregationStats = (explain: Stage): ExecutionStats => {
    return isShardedAggregationExplain(explain)
        ? getShardedAggregationStats(explain)
        : getUnshardedAggregationStats(explain);
};
const getUnshardedAggregationStats = (explain: Stage): ExecutionStats => {
    const firstStage = explain.stages[0] as Stage;
    const cursorKey = getStageCursorKey(firstStage);
    if (!cursorKey) {
        throw new Error("Can not find a cursor stage.");
    }

    const lastStage = explain.stages[explain.stages.length - 1] as Stage;

    const stats = getFindStats(firstStage[cursorKey] as Stage) ?? {};
    stats.nReturned = lastStage.nReturned as number;
    stats.stageIndexes = getIndexesFromStages(explain.stages as Stage[]);
    stats.executionTimeMillis = getAggregationExecutionTime(stats, explain.stages as Stage[]);
    return stats;
};
const getShardedAggregationStats = (explain: Stage): ExecutionStats => {
    const shardStats: Stage[] = [];
    let stageIndexes: IndexInformation[] = [];
    for (const shardName in explain.shards) {
        const shard = explain.shards[shardName] as Stage;
        const stats = shard.stages ? getUnshardedAggregationStats(shard) : getFindStats(shard);

        shardStats.push({
            shardName,
            ...stats,
        } as unknown as Stage);
        stageIndexes = stageIndexes.concat(getIndexesFromStages((shard.stages as Stage[]) ?? [], shardName));
    }

    const nReturned = sumArrayProp(shardStats, "nReturned");
    const executionTimeMillis = sumArrayProp(shardStats, "executionTimeMillis");
    const totalKeysExamined = sumArrayProp(shardStats, "totalKeysExamined");
    const totalDocsExamined = sumArrayProp(shardStats, "totalDocsExamined");
    const response = {
        nReturned,
        executionTimeMillis,
        totalKeysExamined,
        totalDocsExamined,
        allPlansExecution: [],
        executionSuccess: true,
        stageIndexes,
        executionStages: {
            stage: shardStats.length === 1 ? "SINGLE_SHARD" : "SHARD_MERGE",
            nReturned,
            executionTimeMillis,
            totalKeysExamined,
            totalDocsExamined,
            shards: shardStats,
        },
    } as unknown as ExecutionStats;

    return response;
};
const getFindStats = (explain: Stage): ExecutionStats => {
    return explain.executionStats as ExecutionStats;
};

function sumArrayProp(arr: Stage[], prop: string): number {
    return arr.reduce((acc, x) => acc + Number(x[prop] ?? 0), 0);
}

/**
 * @param stages List of all stages in the explain plan
 * @param shard Shard name
 * @returns Indexes used in the stages
 */
function getIndexesFromStages(stages: Stage[], shard?: string): IndexInformation[] {
    return stages
        .reduce((acc: string[], x: Stage) => acc.concat((x?.indexesUsed as string[]) ?? []), [])
        .map((index: string) => ({ index, shard: shard ?? null, fields: {} }));
}

function getAggregationExecutionTime(stats: ExecutionStats, stages: Stage[]): number {
    return (
        // Aggregation execution time is either accessible as part of stats, or as
        // the estimated time of the last stage as execution time for stages is
        // accumulated: every next stage includes the time for the previous stages
        stats.executionTimeMillis ?? (stages[stages.length - 1]?.executionTimeMillisEstimate as number | undefined) ?? 0
    );
}
