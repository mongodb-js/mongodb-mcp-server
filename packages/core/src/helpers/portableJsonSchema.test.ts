import { describe, expect, it } from "vitest";
import { z } from "zod";
import { toPortableJsonSchema, withPortableJsonSchema } from "./portableJsonSchema.js";

describe("toPortableJsonSchema", () => {
    it("rewrites an empty additionalProperties schema to true", () => {
        expect(toPortableJsonSchema({ type: "object", additionalProperties: {} })).toEqual({
            type: "object",
            additionalProperties: true,
        });
    });

    it("drops an empty items schema", () => {
        expect(toPortableJsonSchema({ type: "array", items: {} })).toEqual({ type: "array" });
    });

    it("rewrites nested positions under properties, combinators and items", () => {
        expect(
            toPortableJsonSchema({
                type: "object",
                properties: {
                    filter: { type: "object", additionalProperties: {} },
                    pipeline: {
                        type: "array",
                        items: { anyOf: [{ type: "object", additionalProperties: {} }, { type: "string" }] },
                    },
                },
            })
        ).toEqual({
            type: "object",
            properties: {
                filter: { type: "object", additionalProperties: true },
                pipeline: {
                    type: "array",
                    items: { anyOf: [{ type: "object", additionalProperties: true }, { type: "string" }] },
                },
            },
        });
    });

    it("keeps schemas that carry keywords, including annotation-only ones", () => {
        const schema = {
            type: "object",
            additionalProperties: { description: "kept" },
            properties: { items: {}, tags: { type: "array", items: { type: "string" } } },
        };
        expect(toPortableJsonSchema(schema)).toEqual(schema);
    });

    it("does not rewrite instance data such as default or examples", () => {
        const schema = { type: "object", default: { additionalProperties: {} }, examples: [{ items: {} }] };
        expect(toPortableJsonSchema(schema)).toEqual(schema);
    });

    it("does not mutate its input", () => {
        const schema = { type: "object", properties: { a: { type: "object", additionalProperties: {} } } };
        toPortableJsonSchema(schema);
        expect(schema.properties.a.additionalProperties).toEqual({});
    });
});

describe("withPortableJsonSchema", () => {
    const newSchema = (): z.ZodObject<z.ZodRawShape> =>
        z
            .object({
                query: z.object({}).passthrough(),
                documents: z.array(z.unknown()),
            })
            .strict();

    it("advertises the portable JSON Schema for both input and output", () => {
        const wrapped = withPortableJsonSchema(newSchema());
        for (const io of ["input", "output"] as const) {
            const json = wrapped["~standard"].jsonSchema[io]({ target: "draft-2020-12" });
            expect(json.properties).toEqual({
                query: { type: "object", properties: {}, additionalProperties: true },
                documents: { type: "array" },
            });
        }
    });

    it("keeps standard validation unchanged", async () => {
        const wrapped = withPortableJsonSchema(newSchema());
        expect(await wrapped["~standard"].validate({ query: { a: 1 }, documents: [1, "x"] })).toEqual({
            value: { query: { a: 1 }, documents: [1, "x"] },
        });
        const invalid = await wrapped["~standard"].validate({ query: "nope", documents: [] });
        expect("issues" in invalid && invalid.issues?.length).toBeTruthy();
    });

    it("returns the same Zod instance, so Zod methods keep working", () => {
        const schema = newSchema();
        const wrapped = withPortableJsonSchema(schema);
        expect(wrapped).toBe(schema);
        expect(wrapped.safeParse({ query: {}, documents: [] }).success).toBe(true);
        expect(wrapped.safeParse({ query: {}, documents: [], bogus: 1 }).success).toBe(false);
    });

    it("only affects the instance it is given", () => {
        const other = newSchema();
        withPortableJsonSchema(newSchema());
        const json = other["~standard"].jsonSchema.input({ target: "draft-2020-12" });
        expect((json.properties as Record<string, unknown>).documents).toEqual({ type: "array", items: {} });
    });
});
