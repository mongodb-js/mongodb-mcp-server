import { ExpectedToolCall, LLMToolCall } from "./accuracyResultStorage/resultStorage.js";
import { Matcher } from "./matcher.js";

/**
 * Tool calling accuracy is a single number calculated based on two dimensions.
 * 1. Did LLM call the right tool?
 * 2. Did LLM call the tool with correct and required parameters?
 *
 * The number can be one of:
 * - 0: When LLM:
 *    - did not call the right tool
 *    - did not call the tool with correct parameters
 * - 0.75: When LLM:
 *    - called the right tool but hallucinated and called some extra tools as
 *      well or called the same tool but with different parameters
 *    - called the right tool but hallucinated and called it with some
 *      non-required parameters
 * - 1: When LLM:
 *    - called exactly the tools that were expected
 *    - called the expected tools exactly with the expected parameters
 *
 * To calculate this number we must have:
 * 1. a list of expected tool calls with their expected parameters
 * 2. a list of LLM tool calls with their parameters
 *
 * For each expected tool call we find the best matching LLM tool call. Best
 * matching LLM tool call will have:
 * 1. the same name as that of the expected tool call
 * 2. highest parameter similarity score, with at-least 0.75 to ensure an actual
 *    match. And in case of competing scores, we take the first one that appears
 *    in the LLM tool calls.
 *
 * Using the above logic we establish pairs between expected and actual tool
 * calls.
 *
 * 1. If we could not pair some LLM tool calls with expected tool calls that
 *    means the LLM hallucinated over the extra tool calls. For that reason we
 *    will cap the maximum achievable accuracy to 0.75.
 *
 * 2. If we could not pair some expected tool calls with LLM tool calls that
 *    means the LLM did not call one of the expected tool required to solve the
 *    problem. For that reason we will mark the accuracy as 0 and exit early.
 *
 * 3. Now for each of the established tool call pairs, we will determine how
 *    correctly the parameters were called using the parameter similarity score.
 *    The parameter similarity score follow the same accuracy number pattern
 *    described above:
 *      - 0 : for missing parameters, incorrect parameter values
 *      - 0.75 : for additional parameters
 *      - 1 : for a perfect match
 *
 * The final accuracy score is then calculated as the least of:
 * - Maximum achievable accuracy from #1
 * - The least of parameter similarity score from the established pairs in #3
 *
 * For examples: see the test cases in - tests/unit/accuracy-scorer.test.ts
 */
export function calculateToolCallingAccuracy(
    expectedToolCalls: ExpectedToolCall[],
    actualToolCalls: LLMToolCall[]
): number {
    if (expectedToolCalls.length === 0) {
        return actualToolCalls.length === 0 ? 1 : 0.75;
    }

    let currentScore = actualToolCalls.length > expectedToolCalls.length ? 0.75 : 1;
    const checkedActualToolCallIndexes = new Set<number>();

    for (const expectedCall of expectedToolCalls) {
        const candidates = actualToolCalls
            .map((call, index) => ({ call, index }))
            .filter(
                ({ call, index }) => !checkedActualToolCallIndexes.has(index) && call.toolName === expectedCall.toolName
            )
            .map(({ call, index }) => ({
                call,
                index,
                score: Matcher.value(expectedCall.parameters).match(call.parameters),
            }))
            .filter(({ score }) => score >= 0.75)
            .sort((a, b) => b.score - a.score || a.index - b.index);

        const bestMatch = candidates[0];
        if (!bestMatch || bestMatch.score === 0) {
            return 0; // No matching tool call found, return 0
        }

        checkedActualToolCallIndexes.add(bestMatch.index);
        currentScore = Math.min(currentScore, bestMatch.score);
    }

    return currentScore;
}
