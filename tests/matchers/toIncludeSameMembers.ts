import { expect } from "vitest";

export function toIncludeSameMembers<T>(actual: T[], expected: T[]): { pass: boolean; message: () => string } {
    expect(actual).toEqual(expect.arrayContaining(expected as unknown[]));
    expect(expected).toEqual(expect.arrayContaining(actual as unknown[]));

    return {
        pass: true,
        message: () =>
            `Expected arrays to include the same members.\nExpected: ${JSON.stringify(expected)}\nReceived: ${JSON.stringify(actual)}`,
    };
}
