const MATCHER_SYMBOL = Symbol("match");

export abstract class Matcher {
    [MATCHER_SYMBOL] = true;
    public abstract match(actual: unknown): number;

    public static get emptyObjectOrUndefined(): Matcher {
        return new EmptyObjectOrUndefinedMatcher();
    }

    public static get anyValue(): Matcher {
        return new AnyValueMatcher();
    }

    public static number(additionalFilter: (value: number) => boolean = () => true): Matcher {
        return new NumberMatcher(additionalFilter);
    }

    public static anyOf(...matchers: Matcher[]): Matcher {
        return new CompositeMatcher(matchers);
    }

    public static get undefined(): Matcher {
        return new UndefinedMatcher();
    }

    public static boolean(expected?: boolean): Matcher {
        return new BooleanMatcher(expected);
    }

    public static string(): Matcher {
        return new StringMatcher();
    }

    public static value(expected: unknown): Matcher {
        if (typeof expected === "object" && expected !== null && MATCHER_SYMBOL in expected) {
            return expected as Matcher;
        }

        return new ValueMatcher(expected);
    }
}

export const PARAMETER_SCORER_SYMBOL = Symbol("parameterScorer");

class EmptyObjectOrUndefinedMatcher extends Matcher {
    public match(actual: unknown): number {
        if (
            actual === undefined ||
            actual === null ||
            (typeof actual === "object" && Object.keys(actual).length === 0)
        ) {
            return 1; // Match if actual is undefined, null, or an empty object
        }

        return 0; // No match
    }
}

class AnyValueMatcher extends Matcher {
    public match(): number {
        return 1;
    }
}

class NumberMatcher extends Matcher {
    constructor(private additionalFilter: (value: number) => boolean = () => true) {
        super();
    }
    public match(actual: unknown): number {
        return typeof actual === "number" && this.additionalFilter(actual) ? 1 : 0;
    }
}

class UndefinedMatcher extends Matcher {
    public match(actual: unknown): number {
        return actual === undefined ? 1 : 0;
    }
}

class CompositeMatcher extends Matcher {
    constructor(private matchers: Matcher[]) {
        super();
    }

    public match(actual: unknown): number {
        let currentScore = 0;

        for (const matcher of this.matchers) {
            const score = matcher.match(actual);
            if (score === 1) {
                return 1; // If one of the matchers is perfect score, return immediately
            }
            currentScore = Math.max(currentScore, score);
        }

        return currentScore;
    }
}

class BooleanMatcher extends Matcher {
    constructor(private expected?: boolean) {
        super();
    }

    public match(actual: unknown): number {
        return typeof actual === "boolean" && (this.expected === undefined || this.expected === actual) ? 1 : 0;
    }
}

class StringMatcher extends Matcher {
    public match(actual: unknown): number {
        return typeof actual === "string" ? 1 : 0;
    }
}

class ValueMatcher extends Matcher {
    constructor(private expected: unknown) {
        super();
    }

    public match(actual: unknown): number {
        if (this.expected === actual) {
            // If both are the same, just return immediately.
            return 1;
        }

        if (this.expected === undefined || this.expected === null) {
            // We expect null/undefined - return 1 if actual is also null/undefined
            return actual === undefined || actual === null ? 1 : 0;
        }

        let currentScore = 1;

        if (Array.isArray(this.expected)) {
            if (!Array.isArray(actual)) {
                // One is an array, the other is not
                return 0;
            }

            if (actual.length > this.expected.length) {
                // Actual array has more elements - this is likely an error (e.g. an aggregation pipeline with extra stages)
                // If we want to allow extra elements, we should add matchers to the array
                return 0;
            }

            for (let i = 0; i < this.expected.length; i++) {
                currentScore = Math.min(currentScore, Matcher.value(this.expected[i]).match(actual[i]));
                if (currentScore === 0) {
                    // If we already found a mismatch, we can stop early
                    return 0;
                }
            }
        } else if (typeof this.expected === "object") {
            if (MATCHER_SYMBOL in this.expected) {
                return (this.expected as Matcher).match(actual);
            }

            if (typeof actual !== "object" || actual === null) {
                // One is an object, the other is not
                return 0;
            }

            const expectedKeys = Object.keys(this.expected);
            const actualKeys = Object.keys(actual);

            if (actualKeys.length > expectedKeys.length) {
                // The model provided more keys than expected - this should not happen.
                // If we want to allow some extra keys, we should specify that in the test definition
                // by adding matchers for those keys.
                return 0;
            }

            for (const key of expectedKeys) {
                currentScore = Math.min(
                    currentScore,
                    Matcher.value((this.expected as Record<string, unknown>)[key]).match(
                        (actual as Record<string, unknown>)[key]
                    )
                );

                if (currentScore === 0) {
                    // If we already found a mismatch, we can stop early
                    return 0;
                }
            }
        } else {
            return 0;
        }

        return currentScore;
    }
}
