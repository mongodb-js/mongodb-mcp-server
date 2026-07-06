import { describe, it, expect, expectTypeOf } from "vitest";
import type { IndexDirection, SortDirection } from "mongodb";
import type { z } from "zod";
import { IndexDirectionSchema, SortDirectionSchema } from "../../../../src/tools/mongodb/mongodbSchemas.js";

describe("IndexDirectionSchema", () => {
    type Ours = z.infer<typeof IndexDirectionSchema>;

    it("matches mongodb's IndexDirection (except for arbitrary numbers)", () => {
        // Output type is assignable to the driver's IndexDirection.
        expectTypeOf<Ours>().toExtend<IndexDirection>();

        // IndexDirection = -1 | 1 | "2d" | "2dsphere" | "text" | "geoHaystack" | "hashed" | number.
        // Since `number` absorbs the 1 | -1 literals, the only literals the driver's
        // type still distinguishes are the string ones. Those must all be in our schema.
        type DriverStringLiterals = Exclude<IndexDirection, number>;
        expectTypeOf<DriverStringLiterals>().toExtend<Ours>();

        // Accept every known IndexDirection literal value at runtime.
        const valid: IndexDirection[] = [1, -1, "2d", "2dsphere", "text", "geoHaystack", "hashed"];
        for (const value of valid) {
            expect(IndexDirectionSchema.parse(value)).toBe(value);
        }
    });

    it("rejects arbitrary numbers (the intentional gap vs. the driver's type)", () => {
        expect(() => IndexDirectionSchema.parse(0)).toThrow();
        expect(() => IndexDirectionSchema.parse(2)).toThrow();
        expect(() => IndexDirectionSchema.parse(1.5)).toThrow();
    });

    it("rejects unknown strings and non-scalar values", () => {
        expect(() => IndexDirectionSchema.parse("foobar")).toThrow();
        expect(() => IndexDirectionSchema.parse("")).toThrow();
        expect(() => IndexDirectionSchema.parse({})).toThrow();
        expect(() => IndexDirectionSchema.parse(null)).toThrow();
        expect(() => IndexDirectionSchema.parse(undefined)).toThrow();
    });
});

describe("SortDirectionSchema", () => {
    type Ours = z.infer<typeof SortDirectionSchema>;

    it("matches mongodb's SortDirection", () => {
        // Output type is assignable to the driver's SortDirection.
        expectTypeOf<Ours>().toExtend<SortDirection>();

        // Every value the driver's SortDirection accepts must be expressible in our schema.
        // SortDirection = 1 | -1 | "asc" | "desc" | "ascending" | "descending" | { $meta: string }.
        // There's no numeric widening here (unlike IndexDirection), so the match should be exact.
        expectTypeOf<SortDirection>().toExtend<Ours>();

        // Accept every known SortDirection value at runtime.
        const validLiterals: SortDirection[] = [1, -1, "asc", "desc", "ascending", "descending"];
        for (const value of validLiterals) {
            expect(SortDirectionSchema.parse(value)).toBe(value);
        }
        expect(SortDirectionSchema.parse({ $meta: "textScore" })).toEqual({ $meta: "textScore" });
    });

    it("rejects unknown strings, arbitrary numbers, and malformed $meta objects", () => {
        expect(() => SortDirectionSchema.parse("up")).toThrow();
        expect(() => SortDirectionSchema.parse("")).toThrow();
        expect(() => SortDirectionSchema.parse(0)).toThrow();
        expect(() => SortDirectionSchema.parse(2)).toThrow();
        expect(() => SortDirectionSchema.parse({})).toThrow();
        expect(() => SortDirectionSchema.parse({ $meta: 1 })).toThrow();
        expect(() => SortDirectionSchema.parse(null)).toThrow();
        expect(() => SortDirectionSchema.parse(undefined)).toThrow();
    });
});
