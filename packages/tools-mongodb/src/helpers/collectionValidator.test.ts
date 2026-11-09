import { describe, expect, it } from "vitest";
import {
    convertMongoDBJSONSchemaToSimplified,
    type SimplifiedSchema,
    type SimplifiedSchemaType,
} from "@mongodb-js/mongodb-schema";
import { getJsonSchemaValidator, mergeSimplifiedSchemas } from "./collectionValidator.js";

describe("getJsonSchemaValidator", () => {
    const jsonSchema = {
        bsonType: "object",
        required: ["name"],
        properties: { name: { bsonType: "string" } },
    };

    it.each([
        { name: "undefined options", options: undefined },
        { name: "no validator", options: {} },
        { name: "query-only validator", options: { validator: { status: { $in: ["a", "b"] } } } },
        { name: "$jsonSchema nested in $or", options: { validator: { $or: [{ $jsonSchema: jsonSchema }] } } },
        { name: "non-object $jsonSchema", options: { validator: { $jsonSchema: "foo" } } },
    ])("returns undefined for $name", ({ options }) => {
        expect(getJsonSchemaValidator(options)).toBeUndefined();
    });

    it("returns a top-level $jsonSchema and defaults to strict/error", () => {
        expect(getJsonSchemaValidator({ validator: { $jsonSchema: jsonSchema } })).toEqual({
            jsonSchema,
            validationLevel: "strict",
            validationAction: "error",
            isEnforced: true,
            isExhaustive: false,
        });
    });

    it("returns a $jsonSchema combined with query operators", () => {
        const result = getJsonSchemaValidator({
            validator: { $jsonSchema: jsonSchema, status: { $in: ["a", "b"] } },
        });
        expect(result?.jsonSchema).toEqual(jsonSchema);
    });

    it("returns a $jsonSchema nested in $and", () => {
        const result = getJsonSchemaValidator({
            validator: { $and: [{ status: "a" }, { $jsonSchema: jsonSchema }] },
        });
        expect(result?.jsonSchema).toEqual(jsonSchema);
    });

    it("combines multiple $jsonSchema clauses with allOf", () => {
        const otherSchema = { bsonType: "object", properties: { age: { bsonType: "int" } } };
        const result = getJsonSchemaValidator({
            validator: { $jsonSchema: jsonSchema, $and: [{ $jsonSchema: otherSchema }] },
        });
        expect(result?.jsonSchema).toEqual({ allOf: [jsonSchema, otherSchema] });
        expect(convertMongoDBJSONSchemaToSimplified(result!.jsonSchema)).toEqual({
            name: { types: [{ bsonType: "String" }] },
            age: { types: [{ bsonType: "Int32" }] },
        });
    });

    it("is enforced with validationLevel=strict and validationAction=errorAndLog", () => {
        expect(
            getJsonSchemaValidator({
                validator: { $jsonSchema: jsonSchema },
                validationLevel: "strict",
                validationAction: "errorAndLog",
            })?.isEnforced
        ).toBe(true);
    });

    it.each([
        { validationLevel: "moderate", validationAction: "error" },
        { validationLevel: "off", validationAction: "error" },
        { validationLevel: "strict", validationAction: "warn" },
    ])(
        "is not enforced with validationLevel=$validationLevel and validationAction=$validationAction",
        ({ validationLevel, validationAction }) => {
            expect(
                getJsonSchemaValidator({ validator: { $jsonSchema: jsonSchema }, validationLevel, validationAction })
            ).toEqual({
                jsonSchema,
                validationLevel,
                validationAction,
                isEnforced: false,
                isExhaustive: false,
            });
        }
    );

    describe("isExhaustive", () => {
        const closed = (properties: Record<string, unknown>): Record<string, unknown> => ({
            bsonType: "object",
            additionalProperties: false,
            properties,
        });

        it.each([
            { name: "closed object with scalar fields", schema: closed({ a: { bsonType: "string" } }) },
            {
                name: "closed object with closed nested object",
                schema: closed({ address: closed({ city: { bsonType: "string" } }) }),
            },
            {
                name: "closed object with array of closed objects",
                schema: closed({ tags: { bsonType: "array", items: closed({ name: { bsonType: "string" } }) } }),
            },
            { name: "closed object with enum field", schema: closed({ status: { enum: ["a", "b"] } }) },
            {
                name: "closed object with closed tuple",
                schema: closed({
                    pair: { bsonType: "array", items: [{ bsonType: "int" }], additionalItems: false },
                }),
            },
            {
                name: "anyOf with closed branches",
                schema: { anyOf: [closed({ a: { bsonType: "int" } }), closed({ b: { bsonType: "int" } })] },
            },
        ])("is true for $name", ({ schema }) => {
            expect(getJsonSchemaValidator({ validator: { $jsonSchema: schema } })?.isExhaustive).toBe(true);
        });

        it.each([
            { name: "open object", schema: { bsonType: "object", properties: { a: { bsonType: "string" } } } },
            {
                name: "closed object with open nested object",
                schema: closed({ address: { bsonType: "object", properties: { city: { bsonType: "string" } } } }),
            },
            {
                name: "closed object with array of open objects",
                schema: closed({ tags: { bsonType: "array", items: { bsonType: "object" } } }),
            },
            { name: "closed object with untyped field", schema: closed({ anything: {} }) },
            {
                name: "closed object with unconstrained array",
                schema: closed({ tags: { bsonType: "array" } }),
            },
            {
                name: "closed object with tuple allowing additional items",
                schema: closed({ pair: { bsonType: "array", items: [{ bsonType: "int" }] } }),
            },
            {
                name: "closed object with patternProperties",
                schema: { ...closed({}), patternProperties: { "^x_": { bsonType: "string" } } },
            },
            {
                name: "anyOf with an open branch",
                schema: { anyOf: [closed({ a: { bsonType: "int" } }), { bsonType: "object" }] },
            },
            {
                name: "closed object with untyped field using array keywords",
                schema: closed({ payload: { items: { bsonType: "int" } } }),
            },
            {
                name: "closed object with untyped field using object keywords",
                schema: closed({ payload: { additionalProperties: false, properties: {} } }),
            },
        ])("is false for $name", ({ schema }) => {
            expect(getJsonSchemaValidator({ validator: { $jsonSchema: schema } })?.isExhaustive).toBe(false);
        });
    });
});

describe("mergeSimplifiedSchemas", () => {
    it("keeps sampled fields and prefers declared types at the top level", () => {
        expect(
            mergeSimplifiedSchemas(
                { a: { types: [{ bsonType: "String" }] }, b: { types: [{ bsonType: "Boolean" }] } },
                { a: { types: [{ bsonType: "Int32" }] }, c: { types: [{ bsonType: "Date" }] } }
            )
        ).toEqual({
            a: { types: [{ bsonType: "Int32" }] },
            b: { types: [{ bsonType: "Boolean" }] },
            c: { types: [{ bsonType: "Date" }] },
        });
    });

    it("merges nested document fields", () => {
        expect(
            mergeSimplifiedSchemas(
                {
                    address: {
                        types: [
                            {
                                bsonType: "Document",
                                fields: {
                                    city: { types: [{ bsonType: "String" }] },
                                    zip: { types: [{ bsonType: "String" }] },
                                },
                            },
                        ],
                    },
                },
                {
                    address: {
                        types: [{ bsonType: "Document", fields: { city: { types: [{ bsonType: "String" }] } } }],
                    },
                }
            )
        ).toEqual({
            address: {
                types: [
                    {
                        bsonType: "Document",
                        fields: {
                            city: { types: [{ bsonType: "String" }] },
                            zip: { types: [{ bsonType: "String" }] },
                        },
                    },
                ],
            },
        });
    });

    it("merges documents nested in arrays", () => {
        expect(
            mergeSimplifiedSchemas(
                {
                    tags: {
                        types: [
                            {
                                bsonType: "Array",
                                types: [
                                    { bsonType: "Document", fields: { extra: { types: [{ bsonType: "Int32" }] } } },
                                ],
                            },
                        ],
                    },
                },
                {
                    tags: {
                        types: [
                            {
                                bsonType: "Array",
                                types: [
                                    { bsonType: "Document", fields: { name: { types: [{ bsonType: "String" }] } } },
                                ],
                            },
                        ],
                    },
                }
            )
        ).toEqual({
            tags: {
                types: [
                    {
                        bsonType: "Array",
                        types: [
                            {
                                bsonType: "Document",
                                fields: {
                                    extra: { types: [{ bsonType: "Int32" }] },
                                    name: { types: [{ bsonType: "String" }] },
                                },
                            },
                        ],
                    },
                ],
            },
        });
    });

    it("keeps sampled item types when the declared array has no item constraints", () => {
        const sampledItems: SimplifiedSchemaType[] = [
            { bsonType: "Document", fields: { name: { types: [{ bsonType: "String" }] } } },
        ];
        expect(
            mergeSimplifiedSchemas(
                { tags: { types: [{ bsonType: "Array", types: sampledItems }] } },
                { tags: { types: [{ bsonType: "Array", types: [] }] } }
            )
        ).toEqual({ tags: { types: [{ bsonType: "Array", types: sampledItems }] } });
    });

    it("treats Object.prototype names as plain fields", () => {
        const declared = JSON.parse(
            '{"constructor":{"types":[{"bsonType":"String"}]},"toString":{"types":[{"bsonType":"Int32"}]},"__proto__":{"types":[{"bsonType":"Boolean"}]}}'
        ) as SimplifiedSchema;

        const merged = mergeSimplifiedSchemas({}, declared);
        expect(Object.getPrototypeOf(merged)).toBe(Object.prototype);
        expect(Object.keys(merged)).toEqual(["constructor", "toString", "__proto__"]);
        expect(Object.getOwnPropertyDescriptor(merged, "__proto__")?.value).toEqual({
            types: [{ bsonType: "Boolean" }],
        });
    });
});
