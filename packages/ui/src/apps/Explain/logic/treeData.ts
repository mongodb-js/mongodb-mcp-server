/**
 * Portions ported from mongodb/compass @ adad060c5e
 * Source: packages/compass-explain-plan/src/components/explain-tree/explain-tree-data.ts
 * Copyright MongoDB, Inc. Original license: SSPL-1.0 (MongoDB-internal reuse).
 *
 * Deviation: lodash `omit` replaced with a local helper (equivalent for the
 * plain-JSON stage objects handled here).
 */
import type { Stage } from "./ExplainPlan.js";
import { ExplainPlan } from "./ExplainPlan.js";
import type { ExecutionStats } from "./getExecutionStats.js";

export type ExplainStageHighlights = Record<string, unknown>;
export type ExplainStageDetails = Record<string, unknown>;
export type ExplainTreeNodeData = {
    id: string;
    name: string;
    nReturned: number;
    /* Amount of time spent on this stage */
    curStageExecTimeMS: number;
    /* Execution time spent on all the input stages of this stage, this is the
     * max of the execution times of the children. */
    prevStageExecTimeMS: number;
    isShard: boolean;
    /* ExplainTreeNodeData for the input stages */
    children: ExplainTreeNodeData[];
    /* Raw stage properties */
    details: ExplainStageDetails;
    /* A map of relevant details for the current stage */
    highlights: ExplainStageHighlights;
};

/** Local replacement for lodash `omit` (plain JSON objects only). */
function omitKeys(obj: Record<string, any>, keys: string[]): Record<string, any> {
    const result: Record<string, any> = {};
    for (const key of Object.keys(obj)) {
        if (!keys.includes(key)) {
            result[key] = obj[key];
        }
    }
    return result;
}

const parseExplainTree = (node: Stage, counter: { count: number }): ExplainTreeNodeData => {
    const id = counter.count++;
    const parsedChildren: ExplainTreeNodeData[] = [...ExplainPlan.getChildStages(node)].map((child: Stage) =>
        parseExplainTree(child, counter)
    );

    const isShard = !!node.shardName;

    // NOTE: if there are children we pick the max time, this assumes that the children
    // are executed in parallel (for example with shards). It may make sense to
    // double check if this is a correct assumption also for other types of explain plans
    // and if we won't need to sum the previous times in some instances instead.
    const inputStagesExecTime = parsedChildren.length
        ? Math.max(...parsedChildren.map((c) => c.curStageExecTimeMS))
        : 0;

    const executionTimeMillisEstimate: number | undefined =
        node.executionTimeMillisEstimate !== undefined
            ? (node.executionTimeMillisEstimate as number)
            : (node.executionTimeMillis as number | undefined);

    // if is a shard or if for some reason the current execution time for the node can't be found
    // we assume the node is not an execution stage and keep using the execution time of the
    // input stages
    const currentStageExecTime =
        isShard || executionTimeMillisEstimate === undefined ? inputStagesExecTime : executionTimeMillisEstimate;

    const stage: Omit<ExplainTreeNodeData, "highlights"> = {
        id: `stage-${id}`,
        name: node.stage || (node.shardName as string),
        nReturned: node.nReturned as number,
        curStageExecTimeMS: currentStageExecTime,
        prevStageExecTimeMS: inputStagesExecTime,
        isShard: isShard,
        details: omitKeys(node, ["inputStage", "inputStages", "shards", "executionStages"]),
        children: parsedChildren,
    };
    return { ...stage, highlights: extractHighlights(stage) };
};

const extractHighlights = (stage: Omit<ExplainTreeNodeData, "highlights">): ExplainStageHighlights => {
    switch (stage.name) {
        case "IXSCAN":
        case "EXPRESS_IXSCAN":
            return {
                "Index Name": stage.details?.indexName,
                "Multi Key Index": stage.details?.isMultiKey,
            };
        case "PROJECTION":
            return {
                "Transform by": JSON.stringify(stage.details?.transformBy),
            };
        case "COLLSCAN":
            return {
                "Documents Examined": stage.details?.docsExamined,
            };
        default:
            return {};
    }
};

export const executionStatsToTreeData = (
    executionStats: ExecutionStats | undefined
): ExplainTreeNodeData | undefined => {
    const executionStages = executionStats?.executionStages;
    try {
        return executionStages ? parseExplainTree(executionStages, { count: 0 }) : undefined;
    } catch {
        return undefined;
    }
};
