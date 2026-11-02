import { describe, expect, it } from "vitest";
import { AllTools } from "mongodb-mcp-server";
import { defaultTestConfig, setupIntegrationTest } from "../integrationHelpers.js";

/** Keywords whose value is a single subschema. */
const SUBSCHEMA_KEYWORDS = [
    "items",
    "contains",
    "propertyNames",
    "if",
    "then",
    "else",
    "additionalProperties",
    "unevaluatedProperties",
    "additionalItems",
    "unevaluatedItems",
    "contentSchema",
];

/** Keywords whose value is an array of subschemas. */
const SUBSCHEMA_ARRAY_KEYWORDS = ["allOf", "anyOf", "oneOf", "prefixItems"];

/** Keywords whose value is a name → subschema map. */
const SUBSCHEMA_MAP_KEYWORDS = ["properties", "patternProperties", "dependentSchemas", "$defs", "definitions"];

function isSchemaObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Returns the paths of every subschema that is the empty schema `{}`, which accepts any value and which some MCP
 * clients reject as untyped. `not: {}` is skipped, since there `{}` is the usual spelling of "reject everything".
 * Only subschema positions are visited, so property names and instance data such as `default` are ignored.
 */
function findEmptySchemas(schema: Record<string, unknown>, path: string): string[] {
    const found: string[] = [];
    const visit = (sub: unknown, subPath: string): void => {
        if (!isSchemaObject(sub)) {
            return;
        }
        if (Object.keys(sub).length === 0) {
            found.push(subPath);
        } else {
            found.push(...findEmptySchemas(sub, subPath));
        }
    };

    for (const key of SUBSCHEMA_KEYWORDS) {
        visit(schema[key], `${path}.${key}`);
    }
    for (const key of SUBSCHEMA_ARRAY_KEYWORDS) {
        const subs = schema[key];
        if (Array.isArray(subs)) {
            subs.forEach((sub, index) => visit(sub, `${path}.${key}[${index}]`));
        }
    }
    for (const key of SUBSCHEMA_MAP_KEYWORDS) {
        const map = schema[key];
        if (isSchemaObject(map)) {
            for (const [name, sub] of Object.entries(map)) {
                visit(sub, `${path}.${key}.${name}`);
            }
        }
    }
    if (isSchemaObject(schema.not) && Object.keys(schema.not).length > 0) {
        found.push(...findEmptySchemas(schema.not, `${path}.not`));
    }
    return found;
}

describe("tool schemas", () => {
    const { mcpClient } = setupIntegrationTest(() => ({ ...defaultTestConfig }), { tools: AllTools });

    it("does not advertise the empty schema `{}` in any tool's input or output schema", async () => {
        const { tools } = await mcpClient().listTools();
        expect(tools.length).toBeGreaterThan(0);

        const emptySchemas = tools.flatMap((tool) => [
            ...findEmptySchemas(tool.inputSchema, `${tool.name}: inputSchema`),
            ...(tool.outputSchema ? findEmptySchemas(tool.outputSchema, `${tool.name}: outputSchema`) : []),
        ]);

        // Spell "any value" as `additionalProperties: true` or by leaving `items` out, using
        // ANY_ADDITIONAL_PROPERTIES or ANY_ARRAY_ITEMS from @mongodb-js/mcp-core with `.meta()`.
        expect(emptySchemas).toEqual([]);
    });

    it("finds empty schemas in nested positions", () => {
        expect(
            findEmptySchemas(
                {
                    type: "object",
                    properties: {
                        filter: { type: "object", additionalProperties: {} },
                        ids: { type: "array", items: {} },
                        stages: { anyOf: [{ type: "object", additionalProperties: true }, {}] },
                        items: { type: "string", default: {} },
                    },
                    not: {},
                },
                "tool"
            )
        ).toEqual([
            "tool.properties.filter.additionalProperties",
            "tool.properties.ids.items",
            "tool.properties.stages.anyOf[1]",
        ]);
    });
});
