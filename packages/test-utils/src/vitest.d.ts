import "vitest";

declare module "vitest" {
    interface Assertion<T = unknown> {
        toIncludeSameMembers<U>(expected: U[]): T;
    }

    interface AsymmetricMatchersContaining {
        toIncludeSameMembers<T>(expected: T[]): unknown;
    }
}
