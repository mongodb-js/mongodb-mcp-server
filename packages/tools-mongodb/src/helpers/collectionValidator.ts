import type { Document } from "mongodb";
import type { JSONSchema } from "@mongodb-js/mongodb-schema";

export type JsonSchemaValidator = {
    jsonSchema: JSONSchema;
    validationLevel: string;
    validationAction: string;
    /** True when every write is rejected unless it matches the validator. */
    isEnforced: boolean;
};

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
        isEnforced: validationLevel === "strict" && validationAction === "error",
    };
}
