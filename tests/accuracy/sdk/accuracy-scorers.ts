export type ToolCall = {
    toolCallId: string;
    toolName: string;
    parameters: unknown;
};
export type ExpectedToolCall = Omit<ToolCall, "toolCallId">;

export function toolCallingAccuracyScorer(expectedToolCalls: ExpectedToolCall[], actualToolCalls: ToolCall[]): number {
    if (actualToolCalls.length < expectedToolCalls.length) {
        return 0;
    }

    const possibleScore = actualToolCalls.length > expectedToolCalls.length ? 0.75 : 1;
    const checkedToolCallIds = new Set<string>();
    for (const expectedToolCall of expectedToolCalls) {
        const matchingActualToolCall = actualToolCalls.find(
            (actualToolCall) =>
                actualToolCall.toolName === expectedToolCall.toolName &&
                !checkedToolCallIds.has(actualToolCall.toolCallId)
        );

        if (!matchingActualToolCall) {
            return 0;
        }

        checkedToolCallIds.add(matchingActualToolCall.toolCallId);
    }

    return possibleScore;
}

export function parameterMatchingAccuracyScorer(
    expectedToolCalls: ExpectedToolCall[],
    actualToolCalls: ToolCall[]
): number {
    if (expectedToolCalls.length === 0) {
        return 1;
    }

    const toolCallScores: number[] = [];
    const checkedToolCallIds = new Set<string>();

    for (const expectedToolCall of expectedToolCalls) {
        const matchingActualToolCall = actualToolCalls.find(
            (actualToolCall) =>
                actualToolCall.toolName === expectedToolCall.toolName &&
                !checkedToolCallIds.has(actualToolCall.toolCallId)
        );

        if (!matchingActualToolCall) {
            toolCallScores.push(0);
            continue;
        }

        checkedToolCallIds.add(matchingActualToolCall.toolCallId);
        const score = compareParams(expectedToolCall.parameters, matchingActualToolCall.parameters);
        toolCallScores.push(score);
    }

    const totalScore = toolCallScores.reduce((sum, score) => sum + score, 0);
    return totalScore / toolCallScores.length;
}

/**
 * Recursively compares expected and actual parameters and returns a score.
 * - 1: Perfect match.
 * - 0.75: All expected parameters are present and match, but there are extra actual parameters.
 * - 0: Missing parameters or mismatched values.
 */
function compareParams(expected: unknown, actual: unknown): number {
    if (expected === null || expected === undefined) {
        return actual === null || actual === undefined ? 1 : 0;
    }
    if (actual === null || actual === undefined) {
        return 0;
    }

    if (Array.isArray(expected)) {
        if (!Array.isArray(actual) || actual.length < expected.length) {
            return 0;
        }
        let minScore = 1;
        for (let i = 0; i < expected.length; i++) {
            minScore = Math.min(minScore, compareParams(expected[i], actual[i]));
        }
        if (minScore === 0) {
            return 0;
        }
        if (actual.length > expected.length) {
            minScore = Math.min(minScore, 0.75);
        }
        return minScore;
    }

    if (typeof expected === "object") {
        if (typeof actual !== "object" || Array.isArray(actual)) {
            return 0;
        }
        const expectedKeys = Object.keys(expected as Record<string, unknown>);
        const actualKeys = Object.keys(actual as Record<string, unknown>);

        let minScore = 1;
        for (const key of expectedKeys) {
            if (!Object.prototype.hasOwnProperty.call(actual, key)) {
                return 0;
            }
            minScore = Math.min(
                minScore,
                compareParams((expected as Record<string, unknown>)[key], (actual as Record<string, unknown>)[key])
            );
        }

        if (minScore === 0) {
            return 0;
        }

        if (actualKeys.length > expectedKeys.length) {
            minScore = Math.min(minScore, 0.75);
        }
        return minScore;
    }

    // eslint-disable-next-line eqeqeq
    return expected == actual ? 1 : 0;
}
