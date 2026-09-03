/**
 * Portions ported from mongodb/compass @ adad060c5e
 * Source: packages/explain-plan-helper/src/get-planner-info.ts
 * Copyright MongoDB, Inc. Original license: SSPL-1.0 (MongoDB-internal reuse).
 */
import {
    isAggregationExplain,
    isShardedAggregationExplain,
    isShardedFindExplain,
    getStageCursorKey,
} from "./explainCompat.js";

import type { Stage } from "./ExplainPlan.js";

export interface PlannerInfo {
    namespace: string;
    parsedQuery: Stage;
    winningPlan: Stage;
}

export const getPlannerInfo = (explain: Stage): PlannerInfo => {
    const queryPlanner = isAggregationExplain(explain) ? getAggregationPlanner(explain) : getFindPlanner(explain);
    return {
        namespace: queryPlanner.namespace,
        parsedQuery: queryPlanner.parsedQuery,
        winningPlan: queryPlanner.winningPlan,
    };
};
const getAggregationPlanner = (explain: Stage): Stage => {
    return isShardedAggregationExplain(explain)
        ? getShardedAggregationPlanner(explain)
        : getUnshardedAggregationPlanner(explain);
};
const getUnshardedAggregationPlanner = (explain: Stage): Stage => {
    const firstStage = explain.stages[0] as Stage;
    const cursorKey = getStageCursorKey(firstStage);
    if (!cursorKey) {
        throw new Error("Can not find a cursor stage.");
    }
    return getUnshardedFindPlanner(firstStage[cursorKey] as Stage);
};
const getShardedAggregationPlanner = (explain: Stage): Stage => {
    // The first shard
    const shardNames = Object.keys(explain.shards);
    const firstShard = explain.shards[shardNames[0] ?? ""] as Stage;
    if (firstShard.stages) {
        return getUnshardedAggregationPlanner(firstShard);
    }
    return getUnshardedFindPlanner(firstShard);
};
const getFindPlanner = (explain: Stage): Stage => {
    return isShardedFindExplain(explain) ? getShardedFindPlanner(explain) : getUnshardedFindPlanner(explain);
};
const getUnshardedFindPlanner = (explain: Stage): Stage => {
    return explain.queryPlanner as Stage;
};
const getShardedFindPlanner = (explain: Stage): Stage => {
    return explain.queryPlanner.winningPlan.shards[0] as Stage;
};
