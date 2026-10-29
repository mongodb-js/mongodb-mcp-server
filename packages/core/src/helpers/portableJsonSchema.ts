import type { StandardSchemaWithJSON } from "@modelcontextprotocol/server";

type JsonSchemaObject = Record<string, unknown>;

/**
 * Keywords whose value may be a boolean schema. Zod spells "allow any value" here as `{}`,
 * which some MCP clients treat as an untyped schema; `true` is the equivalent spelling that
 * every client understands.
 */
const BOOLEAN_VALUED_KEYWORDS = new Set([
    "additionalProperties",
    "unevaluatedProperties",
    "additionalItems",
    "unevaluatedItems",
]);

/** Keywords whose value is a single subschema. */
const SUBSCHEMA_KEYWORDS = [
    "items",
    "contains",
    "not",
    "propertyNames",
    "if",
    "then",
    "else",
    "contentSchema",
    ...BOOLEAN_VALUED_KEYWORDS,
];

/** Keywords whose value is an array of subschemas. */
const SUBSCHEMA_ARRAY_KEYWORDS = ["allOf", "anyOf", "oneOf", "prefixItems"];

/** Keywords whose value is a name → subschema map. */
const SUBSCHEMA_MAP_KEYWORDS = ["properties", "patternProperties", "dependentSchemas", "$defs", "definitions"];

function isJsonSchemaObject(value: unknown): value is JsonSchemaObject {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isEmptySchema(value: unknown): boolean {
    return isJsonSchemaObject(value) && Object.keys(value).length === 0;
}

/**
 * Rewrites the always-true `{}` schemas that Zod emits for `z.unknown()`, `z.record(…, z.unknown())`
 * and `.passthrough()` into spellings that are equivalent but portable across MCP clients:
 * - `additionalProperties: {}` (and the other boolean-valued keywords) becomes `true`.
 * - `items: {}` is dropped, since an array without `items` already accepts any element.
 *
 * Only subschema positions are visited, so property names and instance data such as `default`
 * or `examples` are never rewritten. Returns a new object; the input is not mutated.
 */
export function toPortableJsonSchema(schema: JsonSchemaObject): JsonSchemaObject {
    const result: JsonSchemaObject = { ...schema };

    for (const key of SUBSCHEMA_MAP_KEYWORDS) {
        const map = result[key];
        if (isJsonSchemaObject(map)) {
            result[key] = Object.fromEntries(
                Object.entries(map).map(([name, sub]) => [
                    name,
                    isJsonSchemaObject(sub) ? toPortableJsonSchema(sub) : sub,
                ])
            );
        }
    }

    for (const key of SUBSCHEMA_ARRAY_KEYWORDS) {
        const subs = result[key];
        if (Array.isArray(subs)) {
            result[key] = (subs as unknown[]).map((sub) => (isJsonSchemaObject(sub) ? toPortableJsonSchema(sub) : sub));
        }
    }

    for (const key of SUBSCHEMA_KEYWORDS) {
        const sub = result[key];
        if (isEmptySchema(sub)) {
            if (BOOLEAN_VALUED_KEYWORDS.has(key)) {
                result[key] = true;
            } else if (key === "items") {
                delete result[key];
            }
        } else if (isJsonSchemaObject(sub)) {
            result[key] = toPortableJsonSchema(sub);
        }
    }

    return result;
}

/**
 * Makes the JSON Schema the SDK advertises in `tools/list` for `schema` go through
 * {@link toPortableJsonSchema}. Only the `~standard.jsonSchema` converter is overridden, on this
 * instance, so the schema keeps its own type and validation (e.g. Zod's `safeParse`) is unchanged.
 * Pass a schema the caller owns, since the instance itself is modified and returned.
 */
export function withPortableJsonSchema<T extends StandardSchemaWithJSON>(schema: T): T {
    const standard = schema["~standard"];
    Object.defineProperty(schema, "~standard", {
        value: {
            ...standard,
            jsonSchema: {
                input: (options): JsonSchemaObject => toPortableJsonSchema(standard.jsonSchema.input(options)),
                output: (options): JsonSchemaObject => toPortableJsonSchema(standard.jsonSchema.output(options)),
            },
        } satisfies StandardSchemaWithJSON["~standard"],
        configurable: true,
        writable: true,
    });
    return schema;
}
