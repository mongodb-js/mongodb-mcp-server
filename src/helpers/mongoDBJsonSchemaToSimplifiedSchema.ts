import type { MongoDBJSONSchema, SimplifiedSchema, SimplifiedSchemaType } from "mongodb-schema";

/**
 * A $jsonSchema subschema as it can appear in a collection validator. This is a
 * superset of mongodb-schema's `MongoDBJSONSchema` since validators may also use
 * the standard JSON Schema `type`/`oneOf` keywords instead of the BSON-specific ones.
 */
type JsonSchemaNode = MongoDBJSONSchema & {
    type?: string | string[];
    oneOf?: JsonSchemaNode[];
    anyOf?: JsonSchemaNode[];
    properties?: Record<string, JsonSchemaNode>;
    items?: JsonSchemaNode | JsonSchemaNode[];
};

/**
 * Maps MongoDB `$jsonSchema` `bsonType` aliases and standard JSON Schema `type`
 * names to the capitalised BSON type names used by mongodb-schema's SimplifiedSchema.
 */
const TYPE_NAME_MAP: Record<string, string> = {
    // $jsonSchema bsonType aliases
    double: "Double",
    string: "String",
    object: "Document",
    array: "Array",
    binData: "Binary",
    undefined: "Undefined",
    objectId: "ObjectId",
    bool: "Boolean",
    date: "Date",
    null: "Null",
    regex: "BSONRegExp",
    javascript: "Code",
    javascriptWithScope: "CodeWScope",
    symbol: "BSONSymbol",
    int: "Int32",
    timestamp: "Timestamp",
    long: "Int64",
    decimal: "Decimal128",
    minKey: "MinKey",
    maxKey: "MaxKey",
    number: "Number",
    // standard JSON Schema type names not already covered above
    boolean: "Boolean",
    integer: "Int32",
};

function toArray<T>(value: T | T[] | undefined): T[] {
    if (value === undefined) {
        return [];
    }
    return Array.isArray(value) ? value : [value];
}

function mapTypeName(name: string): string {
    return TYPE_NAME_MAP[name] ?? name;
}

function itemTypes(items: JsonSchemaNode | JsonSchemaNode[] | undefined): SimplifiedSchemaType[] {
    return dedupeTypes(toArray(items).flatMap((item) => resolveTypes(item)));
}

/**
 * De-duplicates scalar types by their bsonType while preserving Document/Array
 * types (which carry nested structure) as-is.
 */
function dedupeTypes(types: SimplifiedSchemaType[]): SimplifiedSchemaType[] {
    const seenScalars = new Set<string>();
    const result: SimplifiedSchemaType[] = [];
    for (const type of types) {
        const isScalar = !("fields" in type) && !("types" in type);
        if (isScalar) {
            if (seenScalars.has(type.bsonType)) {
                continue;
            }
            seenScalars.add(type.bsonType);
        }
        result.push(type);
    }
    return result;
}

function resolveTypes(node: JsonSchemaNode): SimplifiedSchemaType[] {
    const result: SimplifiedSchemaType[] = [];

    for (const alternative of [...toArray(node.anyOf), ...toArray(node.oneOf)]) {
        result.push(...resolveTypes(alternative));
    }

    const typeNames = node.bsonType !== undefined ? toArray(node.bsonType) : toArray(node.type);
    if (typeNames.length === 0) {
        // No explicit type - infer a container type from the structural keywords.
        if (node.properties) {
            typeNames.push("object");
        } else if (node.items) {
            typeNames.push("array");
        }
    }

    for (const name of typeNames) {
        const bsonType = mapTypeName(name);
        if (bsonType === "Document") {
            result.push({ bsonType: "Document", fields: convertProperties(node.properties) });
        } else if (bsonType === "Array") {
            result.push({ bsonType: "Array", types: itemTypes(node.items) });
        } else {
            result.push({ bsonType } as SimplifiedSchemaType);
        }
    }

    return dedupeTypes(result);
}

function convertProperties(properties: Record<string, JsonSchemaNode> | undefined): SimplifiedSchema {
    const schema: SimplifiedSchema = {};
    for (const [field, node] of Object.entries(properties ?? {})) {
        schema[field] = { types: resolveTypes(node) };
    }
    return schema;
}

/**
 * Converts a collection validator's `$jsonSchema` into the SimplifiedSchema shape
 * produced by mongodb-schema's sampling, so both schema sources look identical to
 * consumers of the collection-schema tool.
 */
export function mongoDBJsonSchemaToSimplifiedSchema(jsonSchema: JsonSchemaNode): SimplifiedSchema {
    return convertProperties(jsonSchema.properties);
}
