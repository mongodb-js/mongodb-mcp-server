import { defineConfig, globalIgnores } from "eslint/config";
import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import eslintPluginPrettierRecommended from "eslint-plugin-prettier/recommended";
import vitestPlugin from "@vitest/eslint-plugin";

const testFiles = ["tests/**/*.test.ts", "tests/**/*.ts"];

const files = [...testFiles, "src/**/*.ts", "scripts/**/*.ts"];

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
            eqeqeq: "error",
            "no-self-compare": "error",
            "no-unassigned-vars": "error",
            "@typescript-eslint/await-thenable": "error",
            "@typescript-eslint/explicit-function-return-type": "error",
        },
    },
    globalIgnores([
        "node_modules",
        "dist",
        "src/common/atlas/openapi.d.ts",
        "coverage",
        "global.d.ts",
        "eslint.config.js",
        "vitest.config.ts",
        "src/types/*.d.ts",
    ]),
    eslintPluginPrettierRecommended,
]);
