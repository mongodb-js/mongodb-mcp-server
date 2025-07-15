import { expect } from "vitest";

export function toIncludeSameMembers<T>(actual: T[], expected: T[]): { pass: boolean } {
    expect(actual).toEqual(expect.arrayContaining(expected as unknown[]));
    expect(expected).toEqual(expect.arrayContaining(actual as unknown[]));

    return {
        pass: true,
    };
}
