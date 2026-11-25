import type { Document } from "mongodb";
import type {
    JSONSchema,
    SimplifiedSchema,
    SimplifiedSchemaArrayType,
    SimplifiedSchemaBaseType,
    SimplifiedSchemaDocumentType,
    SimplifiedSchemaType,
} from "@mongodb-js/mongodb-schema";

export type JsonSchemaValidator = {
    jsonSchema: JSONSchema;
    validationLevel: string;
    validationAction: string;
    /**
     * True when every write is rejected unless it matches the validator: validationLevel "strict" with a rejecting
     * validationAction, or validationLevel "constraint".
     */
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
    if (branches.length > 0) {
        // Every value must match the branches, so sibling keywords can only narrow it further.
        return branches.every(isExhaustive);
    }

    // Without a declared type, object and array keywords don't rule out the other shape.
    const types = getDeclaredTypes(schema);
    const mayBeObject = !types || types.includes("object");
    const mayBeArray = !types || types.includes("array");

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
        // "constraint" (MongoDB 9.0+) rejects invalid writes regardless of validationAction.
        isEnforced:
            validationLevel === "constraint" ||
            (validationLevel === "strict" && REJECTING_VALIDATION_ACTIONS.includes(validationAction)),
        isExhaustive: isExhaustive(jsonSchema),
    };
}

const MAX_FIELD_DESCRIPTION_LENGTH = 500;

function getSchemaDescription({ title, description }: JSONSchema): string | undefined {
    const parts = [title, description].filter(
        (part): part is string => typeof part === "string" && part.trim().length > 0
    );
    const text = [...new Set(parts.map((part) => part.trim()))].join(": ");
    return text || undefined;
}

/** The descriptions of a field and of what is nested in it, mirroring the shape of the simplified schema. */
type FieldDescriptionNode = {
    descriptions: Set<string>;
    fields: Map<string, FieldDescriptionNode>;
    /** The elements of the field when it is an array, kept apart from the fields it has as a document. */
    items?: FieldDescriptionNode;
};

function createFieldDescriptionNode(): FieldDescriptionNode {
    return { descriptions: new Set(), fields: new Map() };
}

function getFieldDescriptions(schema: JSONSchema): FieldDescriptionNode {
    const root = createFieldDescriptionNode();
    const collect = (subschema: unknown, node: FieldDescriptionNode): void => {
        if (!isDocument(subschema)) {
            return;
        }

        const typedSchema = subschema as JSONSchema;
        const description = node === root ? undefined : getSchemaDescription(typedSchema);
        if (description) {
            node.descriptions.add(description);
        }

        if (isDocument(typedSchema.properties)) {
            for (const [name, propertySchema] of Object.entries(typedSchema.properties)) {
                const child = node.fields.get(name) ?? createFieldDescriptionNode();
                node.fields.set(name, child);
                collect(propertySchema, child);
            }
        }

        for (const itemSchema of [typedSchema.items, typedSchema.additionalItems].flat()) {
            if (isDocument(itemSchema)) {
                node.items ??= createFieldDescriptionNode();
                collect(itemSchema, node.items);
            }
        }

        for (const branch of [
            ...(typedSchema.allOf ?? []),
            ...(typedSchema.anyOf ?? []),
            ...(typedSchema.oneOf ?? []),
        ]) {
            collect(branch, node);
        }
    };
    collect(schema, root);

    return root;
}

type AnnotatedSimplifiedSchemaArrayType = Omit<SimplifiedSchemaArrayType, "types"> & {
    types: AnnotatedSimplifiedSchemaType[];
};

type AnnotatedSimplifiedSchemaDocumentType = Omit<SimplifiedSchemaDocumentType, "fields"> & {
    fields: AnnotatedSimplifiedSchema;
};

type AnnotatedSimplifiedSchemaType =
    | SimplifiedSchemaBaseType
    | AnnotatedSimplifiedSchemaArrayType
    | AnnotatedSimplifiedSchemaDocumentType;

type AnnotatedSimplifiedSchemaField = {
    description?: string;
    types: AnnotatedSimplifiedSchemaType[];
};

/** A simplified schema whose fields, at every nesting level, may carry a description from the validator. */
export type AnnotatedSimplifiedSchema = { [fieldName: string]: AnnotatedSimplifiedSchemaField };

function annotateType(
    type: SimplifiedSchemaType,
    node: FieldDescriptionNode | undefined
): AnnotatedSimplifiedSchemaType {
    if ("fields" in type) {
        return { ...type, fields: annotateFields(type.fields, node) };
    }

    return "types" in type ? { ...type, types: type.types.map((member) => annotateType(member, node?.items)) } : type;
}

/** A field's description, including those of its array elements, which the simplified schema cannot annotate. */
function getFieldDescription(node: FieldDescriptionNode | undefined): string | undefined {
    const descriptions = new Set<string>();
    for (let current = node; current; current = current.items) {
        for (const description of current.descriptions) {
            descriptions.add(description);
        }
    }

    const text = [...descriptions].join("; ");
    if (!text) {
        return undefined;
    }

    return text.length > MAX_FIELD_DESCRIPTION_LENGTH ? `${text.slice(0, MAX_FIELD_DESCRIPTION_LENGTH)}…` : text;
}

function annotateFields(fields: SimplifiedSchema, node: FieldDescriptionNode | undefined): AnnotatedSimplifiedSchema {
    // Object.fromEntries keeps names like `__proto__` as plain fields.
    return Object.fromEntries(
        Object.entries(fields).map(([name, field]) => {
            const child = node?.fields.get(name);
            const types = field.types.map((type) => annotateType(type, child));
            const description = getFieldDescription(child);
            return [name, description ? { description, types } : { types }];
        })
    );
}

/**
 * Adds the `title` and `description` annotations from a `$jsonSchema` validator to the matching fields of a simplified
 * schema, at every nesting level. Fields matched only by `patternProperties` or `additionalProperties` have no concrete
 * path and get none.
 */
export function annotateFieldDescriptions({
    schema,
    jsonSchema,
}: {
    schema: SimplifiedSchema;
    jsonSchema: JSONSchema;
}): AnnotatedSimplifiedSchema {
    return annotateFields(schema, getFieldDescriptions(jsonSchema));
}

function matchesPattern(pattern: string, name: string): boolean {
    try {
        return new RegExp(pattern).test(name);
    } catch {
        // MongoDB accepts PCRE patterns that JS may not; treat those as non-matching.
        return false;
    }
}

/** `{ not: {} }` matches no value, so nothing nested inside it is allowed either. */
function rejectsEverything(schema: JSONSchema): boolean {
    return isDocument(schema.not) && Object.keys(schema.not).length === 0;
}

const REJECT_ALL: JSONSchema = { not: {} };

/**
 * Narrows `schema` to one of its parts (a property or the array items), preserving allOf/anyOf/oneOf semantics.
 * `getLocalSchemas` returns `undefined` when the schema forbids the part outright.
 */
function projectSchema(
    schema: JSONSchema,
    getLocalSchemas: (schema: JSONSchema) => JSONSchema[] | undefined
): JSONSchema {
    const local = rejectsEverything(schema) ? undefined : getLocalSchemas(schema);
    if (!local) {
        return REJECT_ALL;
    }

    const project = (branch: JSONSchema): JSONSchema => projectSchema(branch, getLocalSchemas);
    // A branch that doesn't constrain the part projects to `{ allOf: [] }`, which allows anything.
    return {
        allOf: [...local, ...(schema.allOf ?? []).map(project)],
        ...(schema.anyOf && { anyOf: schema.anyOf.map(project) }),
        ...(schema.oneOf && { oneOf: schema.oneOf.map(project) }),
    };
}

function getPropertySchema(schema: JSONSchema, name: string): JSONSchema {
    return projectSchema(schema, ({ properties = {}, patternProperties = {}, additionalProperties }) => {
        const local: JSONSchema[] = [];
        const propertySchema = Object.hasOwn(properties, name) ? properties[name] : undefined;
        if (propertySchema) {
            local.push(propertySchema);
        }

        for (const [pattern, patternSchema] of Object.entries(patternProperties)) {
            if (matchesPattern(pattern, name)) {
                local.push(patternSchema);
            }
        }

        if (local.length === 0 && isDocument(additionalProperties)) {
            local.push(additionalProperties);
        }

        return local.length === 0 && additionalProperties === false ? undefined : local;
    });
}

function getItemSchema(schema: JSONSchema): JSONSchema {
    return projectSchema(schema, ({ items, additionalItems }) => {
        if (!Array.isArray(items)) {
            return isDocument(items) ? [items] : [];
        }

        // A tuple element only has to match its own position, so any position (or additionalItems) may apply.
        const alternatives: JSONSchema[] = [...(items as JSONSchema[])];
        if (additionalItems !== false) {
            alternatives.push(isDocument(additionalItems) ? additionalItems : {});
        }

        return [{ anyOf: alternatives }];
    });
}

function allowsAdditionalProperty(schema: JSONSchema, name: string): boolean {
    if (rejectsEverything(schema)) {
        return false;
    }

    const locallyAllowed =
        Object.hasOwn(schema.properties ?? {}, name) ||
        Object.keys(schema.patternProperties ?? {}).some((pattern) => matchesPattern(pattern, name)) ||
        schema.additionalProperties !== false;
    if (!locallyAllowed) {
        return false;
    }

    // Every allOf clause must allow the property; anyOf/oneOf need at least one branch that allows it.
    if ((schema.allOf ?? []).some((branch) => !allowsAdditionalProperty(branch, name))) {
        return false;
    }
    const alternatives = [...(schema.anyOf ?? []), ...(schema.oneOf ?? [])];
    return alternatives.length === 0 || alternatives.some((branch) => allowsAdditionalProperty(branch, name));
}

/** A copy of a sampled type with its nested contents removed, so merging re-adds only what the schema permits. */
function withoutContents(type: SimplifiedSchemaType): SimplifiedSchemaType {
    if ("fields" in type) {
        return { ...type, fields: {} };
    }

    return "types" in type ? { ...type, types: [] } : type;
}

function mergeTypes({
    sampled,
    declared,
    schema,
}: {
    sampled: SimplifiedSchemaType[];
    declared: SimplifiedSchemaType[];
    schema: JSONSchema;
}): SimplifiedSchemaType[] {
    // An empty declared list means the validator doesn't constrain the type, e.g. an array without `items`.
    const declaredTypes = declared.length > 0 ? declared : sampled.map(withoutContents);

    return declaredTypes.map((declaredType) => {
        const sampledType = sampled.find((type) => type.bsonType === declaredType.bsonType);
        if (sampledType && "fields" in sampledType && "fields" in declaredType) {
            return {
                ...declaredType,
                fields: mergeSimplifiedSchemas({ sampled: sampledType.fields, declared: declaredType.fields, schema }),
            };
        }

        if (sampledType && "types" in sampledType && "types" in declaredType) {
            const types = mergeTypes({
                sampled: sampledType.types,
                declared: declaredType.types,
                schema: getItemSchema(schema),
            });
            return { ...declaredType, types };
        }

        return declaredType;
    });
}

/**
 * Recursively merges a schema inferred from sampled documents with one derived from a validator. Types declared by
 * the validator take precedence, while sampled-only fields are kept only where the validator's `schema` permits them.
 */
export function mergeSimplifiedSchemas({
    sampled,
    declared,
    schema = {},
}: {
    sampled: SimplifiedSchema;
    declared: SimplifiedSchema;
    schema?: JSONSchema;
}): SimplifiedSchema {
    // Own-property lookups and Object.fromEntries keep names like `constructor` and `__proto__` as plain fields.
    const sampledEntries = Object.entries(sampled).filter(([name]) => allowsAdditionalProperty(schema, name));
    const declaredEntries = Object.entries(declared).map(([name, declaredField]) => {
        const sampledField = Object.hasOwn(sampled, name) ? sampled[name] : undefined;
        if (!sampledField) {
            return [name, declaredField];
        }

        const types = mergeTypes({
            sampled: sampledField.types,
            declared: declaredField.types,
            schema: getPropertySchema(schema, name),
        });
        return [name, { types }];
    });

    return Object.fromEntries([...sampledEntries, ...declaredEntries]) as SimplifiedSchema;
}
