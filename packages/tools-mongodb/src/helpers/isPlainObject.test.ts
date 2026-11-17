import { describe, expect, it } from "vitest";
import { isPlainObject } from "@mongodb-js/mcp-tools-mongodb";

describe("isPlainObject", () => {
    it("should return true for plain objects", () => {
        expect(isPlainObject({})).toBe(true);
        expect(isPlainObject({ a: 1 })).toBe(true);
        expect(isPlainObject(Object.create(null))).toBe(true);
    });

    it("should return false for arrays, null, and non-objects", () => {
        expect(isPlainObject([])).toBe(false);
        expect(isPlainObject(null)).toBe(false);
        expect(isPlainObject(undefined)).toBe(false);
        expect(isPlainObject("string")).toBe(false);
        expect(isPlainObject(1)).toBe(false);
        expect(isPlainObject(true)).toBe(false);
        expect(isPlainObject(() => {})).toBe(false);
    });
});
