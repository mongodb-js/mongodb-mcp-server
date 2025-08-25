import path from "path";
import { RuleTester } from "eslint";
import { describe, it } from "vitest";
import tsParser from "@typescript-eslint/parser";
import rule from "./no-config-imports.js";

const ROOT = process.cwd();
const resolve = (p) => path.resolve(ROOT, p);

const ruleTester = new RuleTester({
    languageOptions: {
        parser: tsParser,
        parserOptions: { ecmaVersion: 2022, sourceType: "module" },
    },
});

describe("no-config-imports", () => {
    it("should not report any violations", () => {
        ruleTester.run("no-config-imports", rule, {
            valid: [
                {
                    filename: resolve("src/some/module.ts"),
                    code: 'import type { UserConfig } from "../common/config.js";\n',
                },
                {
                    filename: resolve("src/some/module.ts"),
                    code: 'import { something } from "../common/logger.js";\n',
                },
                {
                    filename: resolve("src/some/module.ts"),
                    code: 'import type * as Cfg from "../common/config.js";\n',
                },
                {
                    filename: resolve("src/index.ts"),
                    code: 'import { driverOptions } from "../common/config.js";\n',
                },
            ],
            invalid: [],
        });
    });

    it("should report rule violations", () => {
        ruleTester.run("no-config-imports", rule, {
            valid: [],
            invalid: [
                {
                    filename: resolve("src/another/module.ts"),
                    code: 'import { driverOptions } from "../common/config.js";\n',
                    errors: [{ messageId: "noConfigImports" }],
                },
                {
                    filename: resolve("src/another/module.ts"),
                    code: 'import configDefault from "../common/config.js";\n',
                    errors: [{ messageId: "noConfigImports" }],
                },
                {
                    filename: resolve("src/another/module.ts"),
                    code: 'import * as cfg from "../common/config.js";\n',
                    errors: [{ messageId: "noConfigImports" }],
                },
                {
                    filename: resolve("src/another/module.ts"),
                    code: 'import { type UserConfig, driverOptions } from "../common/config.js";\n',
                    errors: [{ messageId: "noConfigImports" }],
                },
            ],
        });
    });
});
