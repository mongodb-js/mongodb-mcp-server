import type { RunEvalScorerArgs } from "./datasetTypes.js";

type ScoreResult = {
    name: string;
    score: number;
    metadata?: Record<string, unknown>;
};

/**
 * Reads the llm_judge verdict computed in the task. Skipped when no judge ran.
 * @param args - The arguments for the scoring function.
 * @returns The score result.
 */
export function llmJudgeScore(args: RunEvalScorerArgs): ScoreResult | null {
    const judge = args.output.judge;
    if (!judge) return null;
    return {
        name: "llm_judge",
        score: judge.score,
        metadata: { explanation: judge.explanation },
    };
}
