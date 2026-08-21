import { describe, expect, it } from "vitest";

describe("toIncludeSameMembers matcher", () => {
    it("should pass when arrays contain the same elements in different order", () => {
        const array1 = [1, 2, 3];
        const array2 = [3, 1, 2];

        expect(array1).toIncludeSameMembers(array2);
    });

    it("should pass when arrays contain the same elements in same order", () => {
        const array1 = [1, 2, 3];
        const array2 = [1, 2, 3];

        expect(array1).toIncludeSameMembers(array2);
    });

    it("should fail when arrays have different lengths", () => {
        const array1 = [1, 2, 3];
        const array2 = [1, 2];

        expect(() => expect(array1).toIncludeSameMembers(array2)).toThrow();
    });

    it("should fail when arrays contain different elements", () => {
        const array1 = [1, 2, 3];
        const array2 = [4, 5, 6];

        expect(() => expect(array1).toIncludeSameMembers(array2)).toThrow();
    });

    it("should work with string arrays", () => {
        const array1 = ["apple", "banana", "cherry"];
        const array2 = ["cherry", "apple", "banana"];

        expect(array1).toIncludeSameMembers(array2);
    });

    it("should work with object arrays", () => {
        const array1 = [{ name: "Alice" }, { name: "Bob" }];
        const array2 = [{ name: "Bob" }, { name: "Alice" }];

        expect(array1).toIncludeSameMembers(array2);
    });

    it("should work with mixed type arrays", () => {
        const array1 = [1, "hello", { key: "value" }];
        const array2 = [{ key: "value" }, 1, "hello"];

        expect(array1).toIncludeSameMembers(array2);
    });

    it("should work with empty arrays", () => {
        const array1: unknown[] = [];
        const array2: unknown[] = [];

        expect(array1).toIncludeSameMembers(array2);
    });
});
