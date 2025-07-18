import { DifferenceCreate } from "microdiff";

export const PARAMETER_SCORER_SYMBOL = Symbol("parameterScorer");

export type AdditionalParameterScorer = (additions: DifferenceCreate[]) => number;
export interface ParametersWithScorer {
    [PARAMETER_SCORER_SYMBOL]?: AdditionalParameterScorer;
}

export function withParameterScorer<T extends Record<string, unknown>>(
    parameters: T,
    scorer: AdditionalParameterScorer
): Record<string, unknown> & ParametersWithScorer {
    const result = { ...parameters } as Record<string, unknown> & ParametersWithScorer;
    result[PARAMETER_SCORER_SYMBOL] = scorer;
    return result;
}

function pathComponentsToFullPaths(pathComponents: (string | number)[]): string[] {
    return pathComponents.reduce<string[]>((fullPaths, pathComponent) => {
        if (!fullPaths.length) {
            return [pathComponent.toString()];
        }
        return [...fullPaths, `${fullPaths.pop()}.${pathComponent}`];
    }, []);
}

export const ParameterScorers = {
    noAdditionsAllowedForPaths: (paths: string[]): AdditionalParameterScorer => {
        return (additions: DifferenceCreate[]): number => {
            const hasCriticalAddition = additions.some((diff) => {
                // In case of nested objects / arrays the diff.path could have multiple entries
                const diffPaths = pathComponentsToFullPaths(diff.path);
                return diffPaths.some((diffPath) => paths.includes(diffPath));
            });
            return hasCriticalAddition ? 0 : 0.75;
        };
    },
    emptyAdditionsAllowedForPaths: (paths: string[]): AdditionalParameterScorer => {
        return (additions: DifferenceCreate[]): number => {
            const hasNonEmptyAdditions = additions.some((diff) => {
                const diffPaths = pathComponentsToFullPaths(diff.path);
                const considerablePathHasAdditions = diffPaths.some((diffPath) => paths.includes(diffPath));
                const valueAtPath = diff.value;
                return (
                    considerablePathHasAdditions &&
                    !(
                        valueAtPath === null ||
                        valueAtPath === undefined ||
                        (typeof valueAtPath === "object" && Object.keys(valueAtPath).length === 0) ||
                        (Array.isArray(valueAtPath) && !valueAtPath.length)
                    )
                );
            });

            return hasNonEmptyAdditions ? 0 : 0.75;
        };
    },
} as const;
