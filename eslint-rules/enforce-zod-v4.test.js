import path from "path";
import { RuleTester } from "eslint";
import { describe, it } from "vitest";
import tsParser from "@typescript-eslint/parser";
import rule from "./enforce-zod-v4.js";

const ROOT = process.cwd();
const resolve = (p) => path.resolve(ROOT, p);

const ruleTester = new RuleTester({
    languageOptions: {
        parser: tsParser,
        parserOptions: { ecmaVersion: 2022, sourceType: "module" },
    },
});

describe("enforce-zod-v4", () => {
    it("should allow zod/v4 imports in userConfig.ts", () => {
        ruleTester.run("enforce-zod-v4", rule, {
            valid: [
                {
                    filename: resolve("src/common/config/userConfig.ts"),
                    code: 'import { z } from "zod/v4";\n',
                },
                {
                    filename: resolve("src/common/config/userConfig.ts"),
                    code: 'import * as z from "zod/v4";\n',
                },
                {
                    filename: resolve("src/common/config/userConfig.ts"),
                    code: 'import type { ZodType } from "zod/v4";\n',
                },
            ],
            invalid: [],
        });
    });

    it("should allow regular zod imports in other files", () => {
        ruleTester.run("enforce-zod-v4", rule, {
            valid: [
                {
                    filename: resolve("src/tools/tool.ts"),
                    code: 'import { z } from "zod";\n',
                },
                {
                    filename: resolve("src/resources/resource.ts"),
                    code: 'import * as z from "zod";\n',
                },
                {
                    filename: resolve("src/some/module.ts"),
                    code: 'import type { ZodType } from "zod";\n',
                },
            ],
            invalid: [],
        });
    });

    it("should allow non-zod imports in any file", () => {
        ruleTester.run("enforce-zod-v4", rule, {
            valid: [
                {
                    filename: resolve("src/tools/tool.ts"),
                    code: 'import { something } from "some-package";\n',
                },
                {
                    filename: resolve("src/common/config/userConfig.ts"),
                    code: 'import path from "path";\n',
                },
                {
                    filename: resolve("src/resources/resource.ts"),
                    code: 'import { Logger } from "./logger.js";\n',
                },
            ],
            invalid: [],
        });
    });

    it("should report error when zod/v4 is imported in files other than config.ts", () => {
        ruleTester.run("enforce-zod-v4", rule, {
            valid: [],
            invalid: [
                {
                    filename: resolve("src/tools/tool.ts"),
                    code: 'import { z } from "zod/v4";\n',
                    errors: [
                        {
                            messageId: "enforceZodV4",
                            data: { importPath: "zod/v4" },
                        },
                    ],
                },
                {
                    filename: resolve("src/resources/resource.ts"),
                    code: 'import * as z from "zod/v4";\n',
                    errors: [
                        {
                            messageId: "enforceZodV4",
                            data: { importPath: "zod/v4" },
                        },
                    ],
                },
                {
                    filename: resolve("src/some/module.ts"),
                    code: 'import type { ZodType } from "zod/v4";\n',
                    errors: [
                        {
                            messageId: "enforceZodV4",
                            data: { importPath: "zod/v4" },
                        },
                    ],
                },
                {
                    filename: resolve("tests/unit/toolBase.test.ts"),
                    code: 'import { z } from "zod/v4";\n',
                    errors: [
                        {
                            messageId: "enforceZodV4",
                            data: { importPath: "zod/v4" },
                        },
                    ],
                },
            ],
        });
    });

    it("should handle multiple imports in a single file", () => {
        ruleTester.run("enforce-zod-v4", rule, {
            valid: [
                {
                    filename: resolve("src/common/config/userConfig.ts"),
                    code: `import { z } from "zod/v4";
import path from "path";
import type { UserConfig } from "./types.js";
`,
                },
            ],
            invalid: [
                {
                    filename: resolve("src/tools/tool.ts"),
                    code: `import { z } from "zod/v4";
import path from "path";
`,
                    errors: [
                        {
                            messageId: "enforceZodV4",
                            data: { importPath: "zod/v4" },
                        },
                    ],
                },
            ],
        });
    });
});
