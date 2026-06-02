import { describe, expect, it } from "vitest";
import { Long } from "bson";
import { serializeSafeLongs, stringifyEJSON } from "../../../src/helpers/ejson.js";

describe("serializeSafeLongs", () => {
    it("preserves null and undefined", () => {
        expect(serializeSafeLongs(null)).toBeNull();
        expect(serializeSafeLongs(undefined)).toBeUndefined();
    });

    it("leaves standard numbers and primitive types untouched", () => {
        expect(serializeSafeLongs(42)).toBe(42);
        expect(serializeSafeLongs("hello")).toBe("hello");
        expect(serializeSafeLongs(true)).toBe(true);
    });

    it("converts safe Long values to standard JavaScript numbers", () => {
        const safeLong = Long.fromNumber(12345);
        expect(serializeSafeLongs(safeLong)).toBe(12345);
    });

    it("serializes unsafe Long values exceeding Number.MAX_SAFE_INTEGER to strict numberLong object", () => {
        const unsafeLong = Long.fromString("7583362298413593073");
        expect(serializeSafeLongs(unsafeLong)).toEqual({ $numberLong: "7583362298413593073" });
    });

    it("serializes unsafe Long values below Number.MIN_SAFE_INTEGER to strict numberLong object", () => {
        const unsafeLong = Long.fromString("-7583362298413593073");
        expect(serializeSafeLongs(unsafeLong)).toEqual({ $numberLong: "-7583362298413593073" });
    });

    it("handles nested objects and arrays", () => {
        const input = {
            a: Long.fromNumber(100),
            b: Long.fromString("9007199254740992"), // unsafe (MAX_SAFE_INTEGER + 1)
            c: [
                Long.fromNumber(200),
                Long.fromString("-9007199254740992"), // unsafe (MIN_SAFE_INTEGER - 1)
            ],
            nested: {
                d: Long.fromString("123456789012345678"),
            },
        };
        const expected = {
            a: 100,
            b: { $numberLong: "9007199254740992" },
            c: [200, { $numberLong: "-9007199254740992" }],
            nested: {
                d: { $numberLong: "123456789012345678" },
            },
        };
        expect(serializeSafeLongs(input)).toEqual(expected);
    });
});

describe("stringifyEJSON", () => {
    it("stringifies unsafe Long as string preserving exact precision in JSON", () => {
        const data = {
            val: Long.fromString("7583362298413593073"),
            safe: Long.fromNumber(42),
        };
        const result = stringifyEJSON(data);
        expect(result).toBe('{"val":{"$numberLong":"7583362298413593073"},"safe":42}');
    });
});
