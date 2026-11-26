import { describe, expect, it } from "vitest";
import { isRecord } from "@mongodb-js/mcp-tools-mongodb";

describe("isRecord", () => {
    it("should return true for record-like objects", () => {
        expect(isRecord({})).toBe(true);
        expect(isRecord({ a: 1 })).toBe(true);
        expect(isRecord(Object.create(null))).toBe(true);
    });

    it("should return false for arrays, null, and non-objects", () => {
        expect(isRecord([])).toBe(false);
        expect(isRecord(null)).toBe(false);
        expect(isRecord(undefined)).toBe(false);
        expect(isRecord("string")).toBe(false);
        expect(isRecord(1)).toBe(false);
        expect(isRecord(true)).toBe(false);
        expect(isRecord(() => {})).toBe(false);
    });
});
