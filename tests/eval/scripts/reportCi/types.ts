import type { ExperimentSummary } from "braintrust";

/**
 * Best-effort parse of the JSONL summary line emitted by `bt eval --jsonl`, which is a
 * serialized `ExperimentSummary` (`JSON.stringify(summary)`). Fields are optional because the
 * line may be missing, malformed, or a failure object instead of a summary. `isFinal` is emitted
 * by the CLI but isn't part of the published `ExperimentSummary` type.
 */
export type ParsedEvalSummary = Partial<ExperimentSummary> & { isFinal?: boolean };

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
