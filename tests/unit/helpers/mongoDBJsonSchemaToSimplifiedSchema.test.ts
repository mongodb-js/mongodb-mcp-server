import { describe, it, expect } from "vitest";
import type { SimplifiedSchema } from "mongodb-schema";
import { mongoDBJsonSchemaToSimplifiedSchema } from "../../../src/helpers/mongoDBJsonSchemaToSimplifiedSchema.js";

describe("mongoDBJsonSchemaToSimplifiedSchema", () => {
    it("returns an empty schema when there are no properties", () => {
        expect(mongoDBJsonSchemaToSimplifiedSchema({ bsonType: "object" })).toEqual({});
    });

    it("maps scalar bsonType aliases to simplified BSON type names", () => {
        const result = mongoDBJsonSchemaToSimplifiedSchema({
            bsonType: "object",
            properties: {
                _id: { bsonType: "objectId" },
                name: { bsonType: "string" },
                age: { bsonType: "int" },
                score: { bsonType: "double" },
                balance: { bsonType: "decimal" },
                active: { bsonType: "bool" },
                createdAt: { bsonType: "date" },
            },
        });

        expect(result).toEqual<SimplifiedSchema>({
            _id: { types: [{ bsonType: "ObjectId" }] },
            name: { types: [{ bsonType: "String" }] },
            age: { types: [{ bsonType: "Int32" }] },
            score: { types: [{ bsonType: "Double" }] },
            balance: { types: [{ bsonType: "Decimal128" }] },
            active: { types: [{ bsonType: "Boolean" }] },
            createdAt: { types: [{ bsonType: "Date" }] },
        });
    });

    it("maps standard JSON Schema `type` when bsonType is absent", () => {
        const result = mongoDBJsonSchemaToSimplifiedSchema({
            type: "object",
            properties: {
                name: { type: "string" },
                active: { type: "boolean" },
                nickname: { type: "null" },
            },
        });

        expect(result).toEqual<SimplifiedSchema>({
            name: { types: [{ bsonType: "String" }] },
            active: { types: [{ bsonType: "Boolean" }] },
            nickname: { types: [{ bsonType: "Null" }] },
        });
    });

    it("expands an array of bsonTypes into multiple simplified types", () => {
        const result = mongoDBJsonSchemaToSimplifiedSchema({
            bsonType: "object",
            properties: {
                zip: { bsonType: ["string", "null"] },
            },
        });

        expect(result).toEqual<SimplifiedSchema>({
            zip: { types: [{ bsonType: "String" }, { bsonType: "Null" }] },
        });
    });

    it("recurses into nested object properties as Document fields", () => {
        const result = mongoDBJsonSchemaToSimplifiedSchema({
            bsonType: "object",
            properties: {
                address: {
                    bsonType: "object",
                    properties: {
                        city: { bsonType: "string" },
                        zip: { bsonType: "string" },
                    },
                },
            },
        });

        expect(result).toEqual<SimplifiedSchema>({
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

    it("recurses into array items", () => {
        const result = mongoDBJsonSchemaToSimplifiedSchema({
            bsonType: "object",
            properties: {
                tags: {
                    bsonType: "array",
                    items: { bsonType: "string" },
                },
            },
        });

        expect(result).toEqual<SimplifiedSchema>({
            tags: {
                types: [{ bsonType: "Array", types: [{ bsonType: "String" }] }],
            },
        });
    });

    it("flattens anyOf into the field's list of types", () => {
        const result = mongoDBJsonSchemaToSimplifiedSchema({
            bsonType: "object",
            properties: {
                value: {
                    anyOf: [{ bsonType: "string" }, { bsonType: "int" }],
                },
            },
        });

        expect(result).toEqual<SimplifiedSchema>({
            value: { types: [{ bsonType: "String" }, { bsonType: "Int32" }] },
        });
    });

    it("infers Document from properties and Array from items when the type is omitted", () => {
        const result = mongoDBJsonSchemaToSimplifiedSchema({
            properties: {
                meta: {
                    properties: {
                        note: { bsonType: "string" },
                    },
                },
                items: {
                    items: { bsonType: "int" },
                },
            },
        });

        expect(result).toEqual<SimplifiedSchema>({
            meta: {
                types: [
                    {
                        bsonType: "Document",
                        fields: { note: { types: [{ bsonType: "String" }] } },
                    },
                ],
            },
            items: {
                types: [{ bsonType: "Array", types: [{ bsonType: "Int32" }] }],
            },
        });
    });
});
