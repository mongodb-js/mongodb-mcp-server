/**
 * Portions ported from mongodb/compass @ adad060c5e
 * Source: packages/explain-plan-helper/src/index.ts
 * Copyright MongoDB, Inc. Original license: SSPL-1.0 (MongoDB-internal reuse).
 *
 * Deviation: `IndexInformation` allows `string | null` for both `shard` and
 * `index` (Compass compiles without strictNullChecks; this repo is strict).
 */
import { convertExplain } from "./explainCompat.js";
import { getPlannerInfo } from "./getPlannerInfo.js";
import { getExecutionStats } from "./getExecutionStats.js";
import type { ExecutionStats } from "./getExecutionStats.js";
import { getStageIndexFields } from "./getStageIndexFields.js";

const kParent = Symbol("ExplainPlan.kParent");

export type Stage = Record<string, any> & {
    stage: string;
    [kParent]?: Stage | null;
};

export type IndexInformation = {
    fields: Record<string, unknown>;
    shard: string | null;
    index: string | null;
};

export class ExplainPlan {
    namespace: string;
    parsedQuery: Stage;
    executionSuccess: boolean;
    nReturned: number | null;
    executionTimeMillis: number | null;
    totalKeysExamined: number | null;
    totalDocsExamined: number | null;
    originalExplainData: Stage;
    executionStats?: ExecutionStats;
    winningPlan: Stage;

    constructor(originalExplainData: Stage) {
        const rawExplainObject = convertExplain(originalExplainData) as Stage;
        const executionStats = getExecutionStats(rawExplainObject);
        if (executionStats?.executionStages) {
            ExplainPlan.addParentStages(executionStats.executionStages);
        }
        const qpInfo = getPlannerInfo(rawExplainObject);
        const esInfo = executionStats?.executionStages?.shards?.[0] ?? executionStats;
        this.executionStats = executionStats;
        this.namespace = qpInfo.namespace;
        this.parsedQuery = qpInfo.parsedQuery;
        this.executionSuccess = (esInfo?.executionSuccess as boolean | undefined) ?? false;
        this.nReturned = executionStats?.nReturned ?? null;
        this.executionTimeMillis = executionStats?.executionTimeMillis ?? null;
        this.totalKeysExamined = executionStats?.totalKeysExamined ?? null;
        this.totalDocsExamined = executionStats?.totalDocsExamined ?? null;
        this.originalExplainData = originalExplainData;
        this.winningPlan = qpInfo.winningPlan;
    }

    get usedIndexes(): IndexInformation[] {
        const ixscan = this.findAllStagesByName("IXSCAN");
        const expressIxscan = this.findAllStagesByName("EXPRESS_IXSCAN");
        const countScan = this.findAllStagesByName("COUNT_SCAN");
        // special case for IDHACK stage, using the _id_ index.
        const idhack = this.findStageByName("IDHACK");
        const ret: IndexInformation[] = this.executionStats?.stageIndexes ?? [];
        for (const stage of [...ixscan, ...expressIxscan, ...countScan, idhack]) {
            if (!stage) continue;
            let shard: string | null = null;
            if (this.isSharded) {
                for (const parent of ExplainPlan.getParentStages(stage)) {
                    if (typeof parent.shardName === "string") {
                        shard = parent.shardName;
                        break;
                    }
                }
            }
            const index: string = stage === idhack ? "_id_" : (stage.indexName as string);
            const fields = stage === idhack ? { _id: 1 } : getStageIndexFields(stage);
            ret.push({ index, shard, fields });
        }
        if (this.isSharded) {
            for (const shard of (this.executionStats?.executionStages?.shards as Stage[] | undefined) ?? []) {
                if (!ret.some((indexInfo) => indexInfo.shard === shard.shardName)) {
                    ret.push({ index: null, shard: shard.shardName as string, fields: {} });
                }
            }
        }
        return ret.filter(
            (indexInfo, index, arr) =>
                arr.findIndex((i) => i.index === indexInfo.index && i.shard === indexInfo.shard) === index
        );
    }

    get isCovered(): boolean {
        // Not implemented for sharded explain plans (matches Compass behavior)
        if (this.totalDocsExamined && this.totalDocsExamined > 0) {
            return false;
        }
        const ixscan = this.findStageByName("IXSCAN");
        const expressIxscan = this.findStageByName("EXPRESS_IXSCAN");
        const stage = ixscan || expressIxscan;
        return stage?.parentName !== "FETCH";
    }

    get isMultiKey(): boolean {
        return this.findAllStagesByName("IXSCAN").some((stage) => stage.isMultiKey);
    }

    get inMemorySort(): boolean {
        return this.findAllStagesByName("SORT").length !== 0;
    }

    get isCollectionScan(): boolean {
        return this.findStageByName("COLLSCAN") !== null;
    }

    get isSharded(): boolean {
        return !!this.executionStats?.executionStages?.shards;
    }

    get numShards(): number {
        return this.isSharded
            ? ((this.executionStats?.executionStages?.shards as Stage[] | undefined)?.length ?? 0)
            : 0;
    }

    get isClusteredScan(): boolean {
        return Boolean(this.findStageByName("EXPRESS_CLUSTERED_IXSCAN") || this.findStageByName("CLUSTERED_IXSCAN"));
    }

    get indexType(): "CLUSTERED" | "UNAVAILABLE" | "MULTIPLE" | "COLLSCAN" | "COVERED" | "INDEX" {
        const indexes = this.usedIndexes;

        // Currently the CLUSTERED_IXSCAN and EXPRESS_CLUSTERED_IXSCAN do not report
        // any indexes in the winning stage. Even though the query clearly uses
        // an index. And since we can't determine the index used, we will return CLUSTER.
        if (this.isClusteredScan) {
            return "CLUSTERED";
        }

        if (indexes.length === 0) {
            return "UNAVAILABLE";
        }

        const indexInfoByShard = indexes.reduce(
            (acc, index) => {
                if (index.shard) {
                    const shardIndexes = (acc[index.shard] ??= []);
                    shardIndexes.push(index.index);
                }
                return acc;
            },
            {} as Record<string, (string | null)[]>
        );

        const indexNamesForAllShards = Object.values(indexInfoByShard);

        for (let i = 0; i < indexNamesForAllShards.length; i++) {
            for (let j = i + 1; j < indexNamesForAllShards.length; j++) {
                const shardIndexes = indexNamesForAllShards[i];
                const otherShardIndexes = indexNamesForAllShards[j];
                if (
                    shardIndexes &&
                    otherShardIndexes &&
                    (shardIndexes.length !== otherShardIndexes.length ||
                        shardIndexes.some((val, idx) => val !== otherShardIndexes[idx]))
                ) {
                    return "MULTIPLE"; // As in, multiple index setups that differ between shards
                }
            }
        }

        if (this.isCollectionScan) {
            return "COLLSCAN";
        }

        if (this.isCovered) {
            return "COVERED";
        }

        return "INDEX";
    }

    /**
     * Walks the tree of execution stages from a given node (or root) and returns
     * the first stage with the specified name, or null if no stage is found.
     * Equally-named children stages are traversed and returned in order.
     */
    findStageByName(name: string, root?: Stage): Stage | null {
        for (const stage of this._getStageIterator(root)) {
            if (stage.stage === name) {
                return stage;
            }
        }
        return null;
    }

    /**
     * Walks the tree of execution stages from a given node (or root) and returns
     * an array of all stages with the specified name.
     */
    findAllStagesByName(name: string, root?: Stage): Stage[] {
        return [...this._getStageIterator(root)].filter((stage) => stage.stage === name);
    }

    /** DFS stack iterator implementation */
    private *_getStageIterator(root?: Stage): Iterable<Stage> {
        const stage = root ?? this.executionStats?.executionStages ?? this.winningPlan;

        if (!stage) {
            return;
        }

        yield stage;
        for (const child of ExplainPlan.getChildStages(stage)) {
            yield* this._getStageIterator(child);
        }
    }

    serialize(): Pick<
        ExplainPlan,
        | "namespace"
        | "parsedQuery"
        | "executionSuccess"
        | "nReturned"
        | "executionTimeMillis"
        | "totalKeysExamined"
        | "totalDocsExamined"
        | "originalExplainData"
        | "executionStats"
        | "usedIndexes"
        | "isCovered"
        | "isMultiKey"
        | "inMemorySort"
        | "isCollectionScan"
        | "isSharded"
        | "numShards"
        | "indexType"
    > {
        return JSON.parse(
            JSON.stringify({
                namespace: this.namespace,
                parsedQuery: this.parsedQuery,
                executionSuccess: this.executionSuccess,
                nReturned: this.nReturned,
                executionTimeMillis: this.executionTimeMillis,
                totalKeysExamined: this.totalKeysExamined,
                totalDocsExamined: this.totalDocsExamined,
                originalExplainData: this.originalExplainData,
                executionStats: this.executionStats,
                usedIndexes: this.usedIndexes,
                isCovered: this.isCovered,
                isMultiKey: this.isMultiKey,
                inMemorySort: this.inMemorySort,
                isCollectionScan: this.isCollectionScan,
                isSharded: this.isSharded,
                numShards: this.numShards,
                indexType: this.indexType,
            })
        );
    }

    /**
     * Returns child stage or stages of current stage as array. If there are
     * no more child stages, returns empty array. Also works for sharded
     * explain plans (where shards are children).
     */
    static *getChildStages(stage?: Stage): Iterable<Stage> {
        if (!stage) {
            return;
        }

        if (stage.inputStage) {
            yield stage.inputStage as Stage;
        }
        if (stage.executionStages) {
            yield stage.executionStages as Stage;
        }
        if (stage.innerStage) {
            yield stage.innerStage as Stage;
        }
        if (stage.outerStage) {
            yield stage.outerStage as Stage;
        }
        if (stage.thenStage) {
            yield stage.thenStage as Stage;
        }
        if (stage.elseStage) {
            yield stage.elseStage as Stage;
        }
        if (stage.shards) {
            yield* stage.shards as Stage[];
        }
        if (stage.inputStages) {
            yield* stage.inputStages as Stage[];
        }
    }

    /**
     * Recursively add a hidden property to all child stages
     * that points to the parent, or `null` for the root stage.
     * The list of parents can be iterated via getParentStages().
     */
    static addParentStages(stage: Stage): void {
        stage[kParent] = null;
        for (const child of ExplainPlan.getChildStages(stage)) {
            ExplainPlan.addParentStages(child);
            child[kParent] = stage;
        }
    }

    /**
     * Iterator over all parent stages of a stage. Only works if
     * ExplainPlan.addParentStages() has been called on a parent stage
     * first. Does not yield the stage itself.
     */
    static *getParentStages(stage: Stage): Iterable<Stage> {
        let current: Stage | null = stage;
        while ((current = current?.[kParent] ?? null)) {
            yield current;
        }
    }
}
