import { isObjectEmpty } from "../../../src/helpers/isObjectEmpty.js";
import { describe, expect, it } from "vitest";

describe("isObjectEmpty", () => {
    it("returns true for null", () => {
        expect(isObjectEmpty(null)).toBe(true);
    });

    it("returns true for undefined", () => {
        expect(isObjectEmpty(undefined)).toBe(true);
    });

    it("returns true for empty object", () => {
        expect(isObjectEmpty({})).toBe(true);
    });

    it("returns false for object with properties", () => {
        expect(isObjectEmpty({ a: 1 })).toBe(false);
    });
});
