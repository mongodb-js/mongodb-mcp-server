"use strict";
import path from "path";

// The file that is allowed to import from zod/v4
const allowedFilePaths = [
    path.resolve(import.meta.dirname, "../src/common/config/userConfig.ts"),
    path.resolve(import.meta.dirname, "../src/common/config/parseUserConfig.ts"),
];

// Ref: https://eslint.org/docs/latest/extend/custom-rules
export default {
    meta: {
        type: "problem",
        docs: {
            description:
                "Only allow importing 'zod/v4' in config.ts, all other imports are allowed elsewhere. We should only adopt zod v4 for tools and resources once https://github.com/modelcontextprotocol/typescript-sdk/issues/555 is resolved.",
            recommended: true,
        },
        fixable: null,
        messages: {
            enforceZodV4:
                "Only 'zod/v4' imports are allowed in config.ts. Found import from '{{importPath}}'. Use 'zod/v4' instead.",
        },
    },
    create(context) {
        const currentFilePath = path.resolve(context.getFilename());

        // Only allow zod v4 import in config.ts
        if (allowedFilePaths.includes(currentFilePath)) {
            return {};
        }

        return {
            ImportDeclaration(node) {
                const importPath = node.source.value;

                // Check if this is a zod import
                if (typeof importPath !== "string") {
                    return;
                }

                const isZodV4Import = importPath === "zod/v4";

                if (isZodV4Import) {
                    context.report({
                        node,
                        messageId: "enforceZodV4",
                        data: {
                            importPath,
                        },
                    });
                }
            },
        };
    },
};
