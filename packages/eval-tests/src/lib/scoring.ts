import type { Evaluator } from "braintrust";
import type { RunEvalExpected, RunEvalScorerArgs } from "./datasetTypes.js";

type ErrorScoreHandler = NonNullable<Evaluator<unknown, unknown, unknown>["errorScoreHandler"]>;

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

/**
 * Scores errored cases as llm_judge=0 so they count against accuracy instead of being dropped.
 * Braintrust's defaultErrorScoreHandler can't be used: it keys by scorer function name, not "llm_judge".
 */
export const llmJudgeErrorScore: ErrorScoreHandler = ({ rootSpan, data }) => {
    const expected = ("expected" in data ? data.expected : undefined) as RunEvalExpected | undefined;
    if (!expected?.llm_judge) return undefined;
    const scores = { llm_judge: 0 };
    rootSpan.log({ scores });
    return scores;
};
