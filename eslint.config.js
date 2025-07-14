import { defineConfig, globalIgnores } from "eslint/config";
import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import eslintPluginPrettierRecommended from "eslint-plugin-prettier/recommended";
import jestPlugin from "eslint-plugin-jest";

const testFiles = ["tests/**/*.test.ts", "tests/**/*.ts"];

const files = [...testFiles, "src/**/*.ts", "scripts/**/*.ts"];

export default defineConfig([
    { files, plugins: { js }, extends: ["js/recommended"] },
    { files, languageOptions: { globals: globals.node } },
    {
        files: testFiles,
        plugins: {
            jest: jestPlugin,
        },
        languageOptions: {
            globals: {
                ...globals.node,
                ...jestPlugin.environments.globals.globals,
            },
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
