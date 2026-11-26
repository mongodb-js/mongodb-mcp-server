import { describe, expect, it } from "vitest";
import {
    convertMongoDBJSONSchemaToSimplified,
    type JSONSchema,
    type SimplifiedSchema,
    type SimplifiedSchemaType,
} from "@mongodb-js/mongodb-schema";
import { annotateFieldDescriptions, getJsonSchemaValidator, mergeSimplifiedSchemas } from "./collectionValidator.js";

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

    it.each([
        { validationLevel: "strict", validationAction: "errorAndLog" },
        { validationLevel: "constraint", validationAction: "error" },
        { validationLevel: "constraint", validationAction: "errorAndLog" },
        { validationLevel: "constraint", validationAction: "warn" },
    ])(
        "is enforced with validationLevel=$validationLevel and validationAction=$validationAction",
        ({ validationLevel, validationAction }) => {
            expect(
                getJsonSchemaValidator({ validator: { $jsonSchema: jsonSchema }, validationLevel, validationAction })
                    ?.isEnforced
            ).toBe(true);
        }
    );

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
            mergeSimplifiedSchemas({
                sampled: { a: { types: [{ bsonType: "String" }] }, b: { types: [{ bsonType: "Boolean" }] } },
                declared: { a: { types: [{ bsonType: "Int32" }] }, c: { types: [{ bsonType: "Date" }] } },
            })
        ).toEqual({
            a: { types: [{ bsonType: "Int32" }] },
            b: { types: [{ bsonType: "Boolean" }] },
            c: { types: [{ bsonType: "Date" }] },
        });
    });

    it("merges nested document fields", () => {
        expect(
            mergeSimplifiedSchemas({
                sampled: {
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
                declared: {
                    address: {
                        types: [{ bsonType: "Document", fields: { city: { types: [{ bsonType: "String" }] } } }],
                    },
                },
            })
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

    it("does not merge sampled fields into a nested object that forbids additional properties", () => {
        const validator = {
            bsonType: "object",
            properties: {
                address: {
                    bsonType: "object",
                    additionalProperties: false,
                    properties: { city: { bsonType: "string" } },
                },
            },
        };
        const declared = convertMongoDBJSONSchemaToSimplified(validator);

        expect(
            mergeSimplifiedSchemas({
                sampled: {
                    address: {
                        types: [
                            {
                                bsonType: "Document",
                                fields: {
                                    city: { types: [{ bsonType: "String" }] },
                                    legacy: { types: [{ bsonType: "String" }] },
                                },
                            },
                        ],
                    },
                    sampledRootField: { types: [{ bsonType: "Boolean" }] },
                },
                declared,
                schema: validator,
            })
        ).toEqual({
            address: {
                types: [
                    {
                        bsonType: "Document",
                        fields: { city: { types: [{ bsonType: "String" }] } },
                    },
                ],
            },
            sampledRootField: { types: [{ bsonType: "Boolean" }] },
        });
    });

    it("merges documents nested in arrays", () => {
        expect(
            mergeSimplifiedSchemas({
                sampled: {
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
                declared: {
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
                },
            })
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
            mergeSimplifiedSchemas({
                sampled: { tags: { types: [{ bsonType: "Array", types: sampledItems }] } },
                declared: { tags: { types: [{ bsonType: "Array", types: [] }] } },
            })
        ).toEqual({ tags: { types: [{ bsonType: "Array", types: sampledItems }] } });
    });

    const documentWith = (fields: string[]): SimplifiedSchemaType => ({
        bsonType: "Document",
        fields: Object.fromEntries(fields.map((field) => [field, { types: [{ bsonType: "String" }] }])),
    });

    it("keeps sampled fields allowed by any anyOf branch", () => {
        const validator = {
            bsonType: "object",
            anyOf: [
                {
                    properties: {
                        address: {
                            bsonType: "object",
                            additionalProperties: false,
                            properties: { city: { bsonType: "string" } },
                        },
                    },
                },
                { properties: { address: { bsonType: "object", properties: { city: { bsonType: "string" } } } } },
            ],
        };

        expect(
            mergeSimplifiedSchemas({
                sampled: { address: { types: [documentWith(["city", "zip"])] } },
                declared: convertMongoDBJSONSchemaToSimplified(validator),
                schema: validator,
            })
        ).toEqual({ address: { types: [documentWith(["city", "zip"])] } });
    });

    it("drops sampled fields forbidden by every anyOf branch", () => {
        const closedAddress = {
            bsonType: "object",
            additionalProperties: false,
            properties: { city: { bsonType: "string" } },
        };
        const validator = {
            bsonType: "object",
            anyOf: [{ properties: { address: closedAddress } }, { properties: { address: closedAddress } }],
        };

        expect(
            mergeSimplifiedSchemas({
                sampled: { address: { types: [documentWith(["city", "zip"])] } },
                declared: convertMongoDBJSONSchemaToSimplified(validator),
                schema: validator,
            })
        ).toEqual({ address: { types: [documentWith(["city"])] } });
    });

    it("does not treat an anyOf branch that forbids the parent property as allowing its nested fields", () => {
        const validator: JSONSchema = {
            bsonType: "object",
            anyOf: [
                { additionalProperties: false, properties: { other: { bsonType: "string" } } },
                {
                    properties: {
                        address: {
                            bsonType: "object",
                            additionalProperties: false,
                            properties: { city: { bsonType: "string" } },
                        },
                    },
                },
            ],
        };

        expect(
            mergeSimplifiedSchemas({
                sampled: { address: { types: [documentWith(["city", "zip"])] } },
                declared: convertMongoDBJSONSchemaToSimplified(validator),
                schema: validator,
            }).address
        ).toEqual({ types: [documentWith(["city"])] });
    });

    it("keeps sampled tuple item fields allowed by any position", () => {
        const validator = {
            bsonType: "object",
            properties: {
                pair: {
                    bsonType: "array",
                    additionalItems: false,
                    items: [
                        { bsonType: "object", additionalProperties: false, properties: { a: { bsonType: "string" } } },
                        { bsonType: "object", properties: { b: { bsonType: "string" } } },
                    ],
                },
            },
        };
        const declared = convertMongoDBJSONSchemaToSimplified(validator);

        const merged = mergeSimplifiedSchemas({
            sampled: { pair: { types: [{ bsonType: "Array", types: [documentWith(["a", "b", "extra"])] }] } },
            declared,
            schema: validator,
        });
        const [pairType] = merged.pair?.types ?? [];
        const [itemType] = pairType && "types" in pairType ? pairType.types : [];
        expect(itemType && "fields" in itemType ? Object.keys(itemType.fields).sort() : []).toEqual([
            "a",
            "b",
            "extra",
        ]);
    });

    it("filters sampled item fields when the declared array items are closed but untyped", () => {
        const validator = {
            bsonType: "object",
            properties: {
                tags: { bsonType: "array", items: { additionalProperties: false, properties: {} } },
            },
        };

        expect(
            mergeSimplifiedSchemas({
                sampled: { tags: { types: [{ bsonType: "Array", types: [documentWith(["legacy"])] }] } },
                declared: { tags: { types: [{ bsonType: "Array", types: [] }] } },
                schema: validator,
            })
        ).toEqual({ tags: { types: [{ bsonType: "Array", types: [documentWith([])] }] } });
    });

    it("treats Object.prototype names as plain fields", () => {
        const declared = JSON.parse(
            '{"constructor":{"types":[{"bsonType":"String"}]},"toString":{"types":[{"bsonType":"Int32"}]},"__proto__":{"types":[{"bsonType":"Boolean"}]}}'
        ) as SimplifiedSchema;

        const merged = mergeSimplifiedSchemas({ sampled: {}, declared });
        expect(Object.getPrototypeOf(merged)).toBe(Object.prototype);
        expect(Object.keys(merged)).toEqual(["constructor", "toString", "__proto__"]);
        expect(Object.getOwnPropertyDescriptor(merged, "__proto__")?.value).toEqual({
            types: [{ bsonType: "Boolean" }],
        });
    });
});

describe("annotateFieldDescriptions", () => {
    function annotateValidatorSchema(jsonSchema: JSONSchema): ReturnType<typeof annotateFieldDescriptions> {
        return annotateFieldDescriptions({ schema: convertMongoDBJSONSchemaToSimplified(jsonSchema), jsonSchema });
    }

    it("returns the schema unchanged when no field is annotated", () => {
        const schema: SimplifiedSchema = { name: { types: [{ bsonType: "String" }] } };
        const result = annotateFieldDescriptions({
            schema,
            jsonSchema: { title: "Users", description: "All users", properties: { name: { bsonType: "string" } } },
        });
        expect(result).toEqual({ name: { types: [{ bsonType: "String" }] } });
    });

    it("annotates top-level and nested fields", () => {
        expect(
            annotateValidatorSchema({
                bsonType: "object",
                properties: {
                    c_dt: { bsonType: "date", description: "Contract signing date" },
                    addr: {
                        bsonType: "object",
                        description: "Billing address",
                        properties: { zc: { bsonType: "string", description: "Postal code" } },
                    },
                },
            })
        ).toEqual({
            c_dt: { description: "Contract signing date", types: [{ bsonType: "Date" }] },
            addr: {
                description: "Billing address",
                types: [
                    {
                        bsonType: "Document",
                        fields: { zc: { description: "Postal code", types: [{ bsonType: "String" }] } },
                    },
                ],
            },
        });
    });

    it("combines title and description, skipping blank and duplicate values", () => {
        const result = annotateValidatorSchema({
            properties: {
                a: { bsonType: "string", title: "Status", description: "A=active, S=suspended" },
                b: { bsonType: "string", title: "Same", description: "Same" },
                c: { bsonType: "string", title: "  ", description: "Only description" },
                d: { bsonType: "string", title: "Only title" },
            },
        });
        expect(Object.fromEntries(Object.entries(result).map(([name, field]) => [name, field.description]))).toEqual({
            a: "Status: A=active, S=suspended",
            b: "Same",
            c: "Only description",
            d: "Only title",
        });
    });

    it("annotates fields of documents nested in arrays", () => {
        expect(
            annotateValidatorSchema({
                properties: {
                    li: {
                        bsonType: "array",
                        description: "Line items",
                        items: {
                            bsonType: "object",
                            properties: { q: { bsonType: "int", description: "Quantity" } },
                        },
                    },
                },
            })
        ).toEqual({
            li: {
                description: "Line items",
                types: [
                    {
                        bsonType: "Array",
                        types: [
                            {
                                bsonType: "Document",
                                fields: { q: { description: "Quantity", types: [{ bsonType: "Int32" }] } },
                            },
                        ],
                    },
                ],
            },
        });
    });

    it("follows allOf, anyOf and oneOf branches and joins differing descriptions", () => {
        const jsonSchema: JSONSchema = {
            allOf: [{ properties: { a: { description: "From allOf" } } }],
            anyOf: [{ properties: { a: { description: "From anyOf" } } }, { properties: { b: { description: "B" } } }],
            oneOf: [{ properties: { a: { description: "From allOf" } } }],
        };
        const schema: SimplifiedSchema = {
            a: { types: [{ bsonType: "String" }] },
            b: { types: [{ bsonType: "String" }] },
        };
        expect(annotateFieldDescriptions({ schema, jsonSchema })).toEqual({
            a: { description: "From allOf; From anyOf", types: [{ bsonType: "String" }] },
            b: { description: "B", types: [{ bsonType: "String" }] },
        });
    });

    it("annotates sampled fields and ignores described fields missing from the schema", () => {
        const schema: SimplifiedSchema = { a: { types: [{ bsonType: "String" }] } };
        expect(
            annotateFieldDescriptions({
                schema,
                jsonSchema: { properties: { a: { description: "A" }, missing: { description: "Missing" } } },
            })
        ).toEqual({ a: { description: "A", types: [{ bsonType: "String" }] } });
    });

    it("does not confuse nested paths with field names containing dots", () => {
        const schema: SimplifiedSchema = {
            "a.b": { types: [{ bsonType: "String" }] },
            a: { types: [{ bsonType: "Document", fields: { b: { types: [{ bsonType: "String" }] } } }] },
        };
        expect(
            annotateFieldDescriptions({
                schema,
                jsonSchema: {
                    properties: {
                        "a.b": { description: "Dotted name" },
                        a: { properties: { b: { description: "Nested" } } },
                    },
                },
            })
        ).toEqual({
            "a.b": { description: "Dotted name", types: [{ bsonType: "String" }] },
            a: {
                types: [
                    {
                        bsonType: "Document",
                        fields: { b: { description: "Nested", types: [{ bsonType: "String" }] } },
                    },
                ],
            },
        });
    });

    it("skips fields that are only matched by patternProperties or additionalProperties", () => {
        const schema: SimplifiedSchema = { x_a: { types: [{ bsonType: "String" }] } };
        expect(
            annotateFieldDescriptions({
                schema,
                jsonSchema: {
                    patternProperties: { "^x_": { description: "Extension" } },
                    additionalProperties: { description: "Anything else" },
                },
            })
        ).toEqual(schema);
    });

    it("keeps the fields of array elements apart from the fields of a document of the same name", () => {
        const jsonSchema: JSONSchema = {
            properties: {
                payload: {
                    anyOf: [
                        { bsonType: "object", properties: { code: { description: "Document code" } } },
                        {
                            bsonType: "array",
                            description: "List of payloads",
                            items: { bsonType: "object", properties: { code: { description: "Element code" } } },
                        },
                    ],
                },
            },
        };
        const schema: SimplifiedSchema = {
            payload: {
                types: [
                    { bsonType: "Document", fields: { code: { types: [{ bsonType: "String" }] } } },
                    {
                        bsonType: "Array",
                        types: [{ bsonType: "Document", fields: { code: { types: [{ bsonType: "String" }] } } }],
                    },
                ],
            },
        };
        expect(annotateFieldDescriptions({ schema, jsonSchema })).toEqual({
            payload: {
                description: "List of payloads",
                types: [
                    {
                        bsonType: "Document",
                        fields: { code: { description: "Document code", types: [{ bsonType: "String" }] } },
                    },
                    {
                        bsonType: "Array",
                        types: [
                            {
                                bsonType: "Document",
                                fields: { code: { description: "Element code", types: [{ bsonType: "String" }] } },
                            },
                        ],
                    },
                ],
            },
        });
    });

    it("describes an array field with the descriptions of its elements", () => {
        const result = annotateValidatorSchema({
            properties: {
                tags: { bsonType: "array", description: "Tags", items: { bsonType: "string", description: "A tag" } },
                grid: {
                    bsonType: "array",
                    items: { bsonType: "array", items: { bsonType: "int", description: "Cell value" } },
                },
            },
        });
        expect(result.tags?.description).toEqual("Tags; A tag");
        expect(result.grid?.description).toEqual("Cell value");
    });

    it("caps the joined description of a field described by several branches", () => {
        const result = annotateFieldDescriptions({
            schema: { a: { types: [{ bsonType: "String" }] } },
            jsonSchema: {
                allOf: [
                    { properties: { a: { description: "x".repeat(400) } } },
                    { properties: { a: { description: "y".repeat(400) } } },
                ],
            },
        });
        expect(result.a?.description).toEqual(`${"x".repeat(400)}; ${"y".repeat(98)}…`);
    });

    it("truncates long descriptions", () => {
        const result = annotateValidatorSchema({
            properties: { a: { bsonType: "string", description: "x".repeat(600) } },
        });
        expect(result.a?.description).toEqual(`${"x".repeat(500)}…`);
    });

    it("keeps names like __proto__ as plain fields", () => {
        const result = annotateValidatorSchema(
            JSON.parse('{"properties":{"__proto__":{"bsonType":"string","description":"Prototype"}}}') as JSONSchema
        );
        expect(Object.keys(result)).toEqual(["__proto__"]);
        expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
        expect(Object.getOwnPropertyDescriptor(result, "__proto__")?.value).toEqual({
            description: "Prototype",
            types: [{ bsonType: "String" }],
        });
    });
});
