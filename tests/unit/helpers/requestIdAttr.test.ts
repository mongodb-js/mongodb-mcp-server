import { describe, it, expect } from "vitest";
import { requestIdAttr } from "../../../src/helpers/requestIdAttr.js";

describe("requestIdAttr", () => {
    it("returns x-request-id pair when header is a string", () => {
        expect(requestIdAttr({ "x-request-id": "abc-123" })).toEqual({ "x-request-id": "abc-123" });
    });

    it("returns empty object when headers are undefined", () => {
        expect(requestIdAttr(undefined)).toEqual({});
    });

    it("returns empty object when headers are empty", () => {
        expect(requestIdAttr({})).toEqual({});
    });

    it("returns empty object when x-request-id is absent", () => {
        expect(requestIdAttr({ "content-type": "application/json" })).toEqual({});
    });

    it("returns empty object when x-request-id is an array", () => {
        expect(requestIdAttr({ "x-request-id": ["id1", "id2"] })).toEqual({});
    });

    it("returns empty object when x-request-id is a number", () => {
        expect(requestIdAttr({ "x-request-id": 42 })).toEqual({});
    });
});
