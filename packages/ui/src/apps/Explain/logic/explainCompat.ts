/**
 * Portions ported from mongodb/compass @ adad060c5e
 * Source: packages/mongodb-explain-compat/lib/index.js
 * Copyright MongoDB, Inc. Original license: SSPL-1.0 (MongoDB-internal reuse).
 *
 * Converts SBE explain output into a shape compatible with the classic query
 * planner format. https://wiki.corp.mongodb.com/display/QUERY/Explain+Notes
 */

const kDepth = Symbol("kDepth");
const kSBENodes = Symbol("kSBENodes");

export type AnyExplainStage = Record<string, any> & {
    [kDepth]?: number;
    [kSBENodes]?: AnyExplainStage[];
};

type StageMapper = (stage: AnyExplainStage, parent: AnyExplainStage | null) => AnyExplainStage | undefined;

function mapPlanTree(
    stage: AnyExplainStage,
    mapper: StageMapper,
    currentParent: AnyExplainStage | null = null
): AnyExplainStage | undefined {
    const result = mapper(stage, currentParent);
    const target: AnyExplainStage = result ?? {};
    if (stage.inputStage) {
        target.inputStage = mapPlanTree(stage.inputStage, mapper, stage);
    }
    if (stage.innerStage) {
        target.innerStage = mapPlanTree(stage.innerStage, mapper, stage);
    }
    if (stage.outerStage) {
        target.outerStage = mapPlanTree(stage.outerStage, mapper, stage);
    }
    if (stage.thenStage) {
        target.thenStage = mapPlanTree(stage.thenStage, mapper, stage);
    }
    if (stage.elseStage) {
        target.elseStage = mapPlanTree(stage.elseStage, mapper, stage);
    }
    if (stage.inputStages) {
        target.inputStages = stage.inputStages.map((s: AnyExplainStage) => mapPlanTree(s, mapper, stage));
    }
    if (stage.shards) {
        // Deviation from the Compass source, which passed `stage` as the mapper
        // argument here (`mapPlanTree(s, stage)`) — a latent crash if a stage
        // with `shards` were ever traversed. We pass the actual mapper instead.
        target.shards = stage.shards.map((s: AnyExplainStage) => mapPlanTree(s, mapper, stage));
    }
    if (stage.executionStages) {
        target.executionStages = stage.executionStages.map((s: AnyExplainStage) => mapPlanTree(s, mapper, stage));
    }
    return result;
}

function omitChildStages(stage: AnyExplainStage): AnyExplainStage | undefined {
    return mapPlanTree(stage, (child) => (stage === child ? { ...stage } : undefined));
}

function mapStages(queryPlan: AnyExplainStage, sbeExecutionStages: AnyExplainStage): AnyExplainStage {
    const nodeIdToQueryPlan = new Map<number, AnyExplainStage>();

    // First, look up all stages from the query plan, and store their IDs so
    // that we know which SBE nodes we should assign to which query plan node.
    mapPlanTree(queryPlan, (stage) => {
        if (stage.planNodeId) {
            nodeIdToQueryPlan.set(stage.planNodeId, stage);
            stage[kSBENodes] = [];
        }
        return undefined;
    });
    // Then, map the SBE nodes to query plan nodes and keep track of which
    // depth in the tree they are at.
    mapPlanTree(sbeExecutionStages, (stage, parent) => {
        stage[kDepth] = parent ? (parent[kDepth] ?? 0) + 1 : 0;
        if (stage.planNodeId) {
            // Deviation: the source indexes unconditionally and would crash on
            // an unknown planNodeId; we skip such nodes instead.
            nodeIdToQueryPlan.get(stage.planNodeId)?.[kSBENodes]?.push(stage);
        }
        return undefined;
    });

    // Sort SBE nodes per-height so that we have a clear 'head' node that
    // corresponds to the query plan node.
    for (const stage of nodeIdToQueryPlan.values()) {
        stage[kSBENodes]?.sort((s1, s2) => (s1[kDepth] ?? 0) - (s2[kDepth] ?? 0));
    }

    // Do the actual mapping here. Use the head SBE node, and only aggregate
    // 'docsExamined' based on all child nodes and 'executionTimeMillisEstimate'
    // based on all top-level child nodes here.
    const mapped = mapPlanTree(queryPlan, (stage) => {
        // Deviation: the source assumes every query plan stage has collected
        // SBE nodes; we fall back to an empty list if it has none.
        const sbeNodes = stage[kSBENodes] ?? [];
        const headSBENode: AnyExplainStage = sbeNodes[0] ?? {};
        return {
            ...omitChildStages(headSBENode),
            ...omitChildStages(stage),
            executionTimeMillisEstimate: headSBENode.executionTimeMillis ?? headSBENode.executionTimeMillisEstimate,
            docsExamined: sbeNodes
                .filter((sbe) => sbe.stage === "seek" || sbe.stage === "scan")
                .map((sbe) => (sbe.numReads as number) || 0)
                .reduce((a: number, b: number) => a + b, 0),
            keysExamined: sbeNodes
                .filter((sbe) => sbe.stage === "ixseek" || sbe.stage === "ixscan")
                .map((sbe) => (sbe.numReads as number) || 0)
                .reduce((a: number, b: number) => a + b, 0),
        };
    });
    return mapped ?? {};
}

export function isAggregationExplain(explain: AnyExplainStage): boolean {
    return isUnshardedAggregationExplain(explain) || isShardedAggregationExplain(explain);
}
// Only unsharded aggregation has stages property
function isUnshardedAggregationExplain(explain: AnyExplainStage): boolean {
    return !!explain.stages;
}
// Only sharded aggregation has shards property
export function isShardedAggregationExplain(explain: AnyExplainStage): boolean {
    return !!explain.shards;
}

export function isShardedFindExplain(explain: AnyExplainStage): boolean {
    const { mongosPlannerVersion } = explain.queryPlanner ?? {};
    return !isNaN(mongosPlannerVersion);
}

export function getStageCursorKey(stage: AnyExplainStage): string | undefined {
    return Object.keys(stage).find((x) => x.match(/^\$.*cursor/i));
}

function isCursorStage(stage: AnyExplainStage): boolean {
    return !!getStageCursorKey(stage);
}

/**
 * Converts an SBE explain plan to a format that is compatible with the
 * classic query planner explain format.
 */
export function convertExplain(explain: AnyExplainStage): AnyExplainStage {
    explain = JSON.parse(JSON.stringify(explain));

    // In a sharded aggregation, we don't have explainVersion :(
    // In a sharded find, its represented by explain.queryPlanner.mongosPlannerVersion

    // return explain that uses classic engine (except for sharded response)
    if (explain.explainVersion && explain.explainVersion < 2) {
        return explain;
    }
    delete explain.explainVersion;

    if (isAggregationExplain(explain)) {
        if (isShardedAggregationExplain(explain)) {
            explain = mapShardedAggregation(explain);
        } else {
            explain = mapUnshardedAggregation(explain);
        }
    } else {
        if (isShardedFindExplain(explain)) {
            explain = mapShardedFind(explain);
        } else {
            explain = mapUnshardedFind(explain);
        }
    }
    return JSON.parse(JSON.stringify(explain));
}

function mapUnshardedAggregation(explain: AnyExplainStage): AnyExplainStage {
    if (!explain.stages || explain.stages.length === 0) {
        return explain;
    }
    const stages = explain.stages.map((stage: AnyExplainStage) => {
        if (!isCursorStage(stage)) {
            return stage;
        }
        const stageKey = getStageCursorKey(stage);
        if (stageKey) {
            stage[stageKey] = mapPlannerStage(stage[stageKey]);
        }
        return stage;
    });
    explain.stages = stages;
    return explain;
}

function mapShardedAggregation(explain: AnyExplainStage): AnyExplainStage {
    if (!explain.shards) {
        return explain;
    }
    const shards: Record<string, AnyExplainStage> = {};
    for (const shardName in explain.shards) {
        // Shard with stages
        if (explain.shards[shardName].stages) {
            shards[shardName] = mapUnshardedAggregation(explain.shards[shardName]);
        } else {
            shards[shardName] = mapUnshardedFind(explain.shards[shardName]);
        }
    }
    explain.shards = shards;
    return explain;
}

function mapShardedFind(explain: AnyExplainStage): AnyExplainStage {
    const queryPlanner = explain.queryPlanner;
    const executionStats = explain.executionStats;
    if (!queryPlanner.winningPlan.shards) {
        return explain;
    }
    queryPlanner.winningPlan.shards.forEach((shard: AnyExplainStage, index: number) => {
        const winningPlan = shard.winningPlan.queryPlan;
        if (winningPlan && executionStats) {
            const executionStages = mapStages(
                winningPlan,
                executionStats.executionStages.shards[index].executionStages
            );

            queryPlanner.winningPlan.shards[index].winningPlan = winningPlan;
            executionStats.executionStages.shards[index].executionStages = executionStages;
        }
    });
    explain.queryPlanner = queryPlanner;
    explain.executionStats = executionStats;
    return explain;
}

function mapUnshardedFind(explain: AnyExplainStage): AnyExplainStage {
    return mapPlannerStage(explain);
}

function mapPlannerStage(planner: AnyExplainStage): AnyExplainStage {
    if (planner.queryPlanner && planner.queryPlanner.winningPlan && planner.queryPlanner.winningPlan.queryPlan) {
        planner.queryPlanner.plannerVersion = 1;
        const winningPlan = planner.queryPlanner.winningPlan.queryPlan;
        planner.queryPlanner.winningPlan = winningPlan;

        if (planner.executionStats) {
            planner.executionStats.executionStages = mapStages(winningPlan, planner.executionStats.executionStages);
        }
    }
    return planner;
}
