import { describe, expect, it } from "vitest";
import { convertMongoDBJSONSchemaToSimplified } from "@mongodb-js/mongodb-schema";
import { getJsonSchemaValidator } from "./collectionValidator.js";

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
        { validationLevel: "moderate", validationAction: "error" },
        { validationLevel: "off", validationAction: "error" },
        { validationLevel: "strict", validationAction: "warn" },
        { validationLevel: "strict", validationAction: "errorAndLog" },
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
            });
        }
    );
});
