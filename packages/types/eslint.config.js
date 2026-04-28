import mcpApiTypeOnly from "./eslint-rules/mcp-api-type-only.js";

/**
 * ESLint overrides for @mongodb-js/mcp-api (packages/types).
 * Imported from the repo root eslint.config.js.
 */
export default [
    {
        files: ["packages/types/src/**/*.ts"],
        plugins: {
            "mcp-api-type-only": {
                rules: {
                    "mcp-api-type-only": mcpApiTypeOnly,
                },
            },
        },
        rules: {
            "mcp-api-type-only/mcp-api-type-only": "error",
        },
    },
];
