import path from "path";
import { defineConfig, globalIgnores } from "eslint/config";
import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import eslintPluginPrettierRecommended from "eslint-plugin-prettier/recommended";
import vitestPlugin from "@vitest/eslint-plugin";
import enforceZodV4 from "./eslint-rules/enforce-zod-v4.js";

const testFiles = ["tests/**/*.test.ts", "tests/**/*.test.tsx", "tests/**/*.ts", "tests/**/*.tsx"];

const files = [...testFiles, "src/**/*.ts", "src/**/*.tsx", "scripts/**/*.ts"];

export default defineConfig([
    { files, plugins: { js }, extends: ["js/recommended"] },
    { files, languageOptions: { globals: globals.node } },
    {
        files: testFiles,
        plugins: {
            vitest: vitestPlugin,
        },
        languageOptions: {
            globals: {
                ...globals.node,
            },
        },
        rules: {
            ...vitestPlugin.configs.recommended.rules,
            "vitest/valid-title": "off",
            "vitest/no-conditional-expect": "off",
            "vitest/no-standalone-expect": "off",
            "vitest/expect-expect": [
                "error",
                {
                    assertFunctionNames: ["expect", "expectDefined", "verifyMockCalls"],
                },
            ],
        },
    },
    tseslint.configs.recommendedTypeChecked,
    {
        files,
        languageOptions: {
            parserOptions: {
                project: "./tsconfig.json",
                tsconfigRootDir: import.meta.dirname,
            },
        },
    },
    {
        files,
        rules: {
            "@typescript-eslint/switch-exhaustiveness-check": "error",
            "@typescript-eslint/no-non-null-assertion": "error",
            "@typescript-eslint/consistent-type-imports": ["error", { prefer: "type-imports" }],
            "@typescript-eslint/consistent-type-exports": [
                "error",
                {
                    fixMixedExportsWithInlineTypeSpecifier: false,
                },
            ],
            eqeqeq: "error",
            "no-self-compare": "error",
            "no-unassigned-vars": "error",
            "@typescript-eslint/await-thenable": "error",
            "@typescript-eslint/explicit-function-return-type": "error",
        },
    },
    {
        files: ["src/**/*.ts"],
        plugins: {
            "enforce-zod-v4": {
                rules: {
                    "enforce-zod-v4": enforceZodV4,
                },
            },
        },
        rules: {
            "enforce-zod-v4/enforce-zod-v4": "error",
            "no-restricted-imports": [
                "error",
                {
                    paths: [
                        {
                            name: "assert",
                            message:
                                "Use explicit error handling or test framework assertions (e.g., vitest's expect) instead.",
                        },
                        {
                            name: "node:assert",
                            message:
                                "Use explicit error handling or test framework assertions (e.g., vitest's expect) instead.",
                        },
                    ],
                },
            ],
            "no-console": ["error"],
        },
    },
    {
        files: testFiles,
        rules: {
            /** Allow null assertions in test files */
            "@typescript-eslint/no-non-null-assertion": "off",
        },
    },
    {
        files: ["tests/browser/**/*.ts"],
        languageOptions: {
            parserOptions: {
                project: "./tests/browser/tsconfig.json",
                tsconfigRootDir: import.meta.dirname,
            },
        },
    },
    globalIgnores([
        "node_modules",
        "dist",
        "src/common/atlas/openapi.d.ts",
        "src/ui/lib",
        "coverage",
        "global.d.ts",
        "eslint.config.js",
        "vitest.config.ts",
        "vite.ui.config.ts",
        "src/types/*.d.ts",
        "tests/integration/fixtures/",
        "tests/browser/polyfills/**",
        "eslint-rules",
        ".yalc",
    ]),
    eslintPluginPrettierRecommended,
]);
