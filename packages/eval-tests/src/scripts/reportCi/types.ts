import type { ExperimentSummary } from "braintrust";

/**
 * Best-effort parse of the JSONL summary line emitted by `bt eval --jsonl`, which is a
 * serialized `ExperimentSummary` (`JSON.stringify(summary)`). Fields are optional because the
 * line may be missing, malformed, or a failure object instead of a summary.
 */
export type ParsedEvalSummary = Partial<ExperimentSummary>;

/** One accuracy data point on the historical timeline or chart (historical run or current). */
export type TimelinePoint = {
    label: string;
    percent: number;
    experimentId: string;
    experimentName: string;
    experimentUrl?: string;
    commitShort?: string;
    isCurrent?: boolean;
};
