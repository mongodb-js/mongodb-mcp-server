import type { Document } from "mongodb";
import type { JSONSchema, SimplifiedSchema, SimplifiedSchemaType } from "@mongodb-js/mongodb-schema";

export type JsonSchemaValidator = {
    jsonSchema: JSONSchema;
    validationLevel: string;
    validationAction: string;
    /** True when every write is rejected unless it matches the validator. */
    isEnforced: boolean;
    /** True when the validator declares every field a document may contain, at every nesting level. */
    isExhaustive: boolean;
};

const REJECTING_VALIDATION_ACTIONS = ["error", "errorAndLog"];

function isDocument(value: unknown): value is Document {
    return !!value && typeof value === "object" && !Array.isArray(value);
}

function extractJsonSchemas(validator: Document): JSONSchema[] {
    const schemas: JSONSchema[] = [];
    if (isDocument(validator.$jsonSchema)) {
        schemas.push(validator.$jsonSchema);
    }

    if (Array.isArray(validator.$and)) {
        for (const clause of validator.$and as unknown[]) {
            if (isDocument(clause)) {
                schemas.push(...extractJsonSchemas(clause));
            }
        }
    }

    return schemas;
}

function getDeclaredTypes(schema: JSONSchema): string[] | undefined {
    const declared = [schema.bsonType, schema.type].flat().filter((type): type is string => typeof type === "string");
    return declared.length > 0 ? declared : undefined;
}

function isObjectEmptyOrMissing(value: object | undefined): boolean {
    return !value || Object.keys(value).length === 0;
}

function isObjectExhaustive(schema: JSONSchema): boolean {
    return (
        schema.additionalProperties === false &&
        isObjectEmptyOrMissing(schema.patternProperties) &&
        Object.values(schema.properties ?? {}).every(isExhaustive)
    );
}

function isArrayExhaustive(schema: JSONSchema): boolean {
    const { items, additionalItems } = schema;
    if (!items) {
        return false;
    }

    if (!Array.isArray(items)) {
        return isExhaustive(items);
    }

    const additionalItemsExhaustive =
        additionalItems === false || (isDocument(additionalItems) && isExhaustive(additionalItems));
    return additionalItemsExhaustive && (items as JSONSchema[]).every(isExhaustive);
}

/** Conservatively checks whether a schema rules out any field it does not declare. */
function isExhaustive(schema: JSONSchema): boolean {
    if (schema.enum) {
        return true;
    }

    const branches = [...(schema.anyOf ?? []), ...(schema.oneOf ?? []), ...(schema.allOf ?? [])];
    if (!branches.every(isExhaustive)) {
        return false;
    }

    const types = getDeclaredTypes(schema);
    const mayBeObject = types
        ? types.includes("object")
        : schema.properties !== undefined ||
          schema.additionalProperties !== undefined ||
          schema.patternProperties !== undefined;
    const mayBeArray = types ? types.includes("array") : schema.items !== undefined;

    if (!types && !mayBeObject && !mayBeArray) {
        // An untyped schema accepts any value unless its branches constrain it.
        return branches.length > 0;
    }

    return (!mayBeObject || isObjectExhaustive(schema)) && (!mayBeArray || isArrayExhaustive(schema));
}

/**
 * Extracts the `$jsonSchema` validator from the options returned by `listCollections`. Only schemas that
 * apply to every document (top-level or nested in top-level `$and` clauses) are considered.
 */
export function getJsonSchemaValidator(collectionOptions: Document | undefined): JsonSchemaValidator | undefined {
    if (!isDocument(collectionOptions) || !isDocument(collectionOptions.validator)) {
        return undefined;
    }

    const schemas = extractJsonSchemas(collectionOptions.validator);
    const jsonSchema = schemas.length > 1 ? { allOf: schemas } : schemas[0];
    if (!jsonSchema) {
        return undefined;
    }

    const validationLevel =
        typeof collectionOptions.validationLevel === "string" ? collectionOptions.validationLevel : "strict";
    const validationAction =
        typeof collectionOptions.validationAction === "string" ? collectionOptions.validationAction : "error";

    return {
        jsonSchema,
        validationLevel,
        validationAction,
        isEnforced: validationLevel === "strict" && REJECTING_VALIDATION_ACTIONS.includes(validationAction),
        isExhaustive: isExhaustive(jsonSchema),
    };
}

function mergeTypes(sampled: SimplifiedSchemaType[], declared: SimplifiedSchemaType[]): SimplifiedSchemaType[] {
    return declared.map((declaredType) => {
        const sampledType = sampled.find((type) => type.bsonType === declaredType.bsonType);
        if (sampledType && "fields" in sampledType && "fields" in declaredType) {
            return { ...declaredType, fields: mergeSimplifiedSchemas(sampledType.fields, declaredType.fields) };
        }

        if (sampledType && "types" in sampledType && "types" in declaredType) {
            return { ...declaredType, types: mergeTypes(sampledType.types, declaredType.types) };
        }

        return declaredType;
    });
}

/**
 * Recursively merges a schema inferred from sampled documents with one derived from a validator. Types declared by
 * the validator take precedence, while fields only found in the sample are kept at every nesting level.
 */
export function mergeSimplifiedSchemas(sampled: SimplifiedSchema, declared: SimplifiedSchema): SimplifiedSchema {
    const merged: SimplifiedSchema = { ...sampled };
    for (const [name, declaredField] of Object.entries(declared)) {
        const sampledField = sampled[name];
        merged[name] = sampledField ? { types: mergeTypes(sampledField.types, declaredField.types) } : declaredField;
    }

    return merged;
}
