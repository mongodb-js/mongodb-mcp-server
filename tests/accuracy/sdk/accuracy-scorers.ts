import diff from "microdiff";
import { ExpectedToolCall, ActualToolCall } from "./accuracy-snapshot-storage/snapshot-storage.js";

export function calculateToolCallingAccuracy(
    expectedToolCalls: ExpectedToolCall[],
    actualToolCalls: ActualToolCall[]
): number {
    if (expectedToolCalls.length === 0) {
        return actualToolCalls.length === 0 ? 1 : 0.75;
    }

    const maxAccuracy = actualToolCalls.length > expectedToolCalls.length ? 0.75 : 1;

    const individualAccuracies: number[] = [];
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
                score: compareParams(expectedCall.parameters, call.parameters),
            }))
            .filter(({ score }) => score >= 0.75)
            .sort((a, b) => b.score - a.score);

        const bestMatch = candidates[0];
        if (!bestMatch) {
            individualAccuracies.push(0);
        } else {
            checkedActualToolCallIndexes.add(bestMatch.index);
            const individualAccuracy = Math.min(bestMatch.score, maxAccuracy);
            individualAccuracies.push(individualAccuracy);
        }
    }

    return Math.min(...individualAccuracies);
}

function compareParams(expected: Record<string, unknown>, actual: Record<string, unknown>): number {
    const differences = diff(expected, actual);

    if (differences.length === 0) {
        return 1;
    }

    const hasOnlyAdditions = differences.every((d) => d.type === "CREATE");
    const hasRemovals = differences.some((d) => d.type === "REMOVE");
    const hasChanges = differences.some((d) => d.type === "CHANGE");

    if (hasOnlyAdditions && !hasRemovals && !hasChanges) {
        return 0.75;
    }

    return 0;
}
