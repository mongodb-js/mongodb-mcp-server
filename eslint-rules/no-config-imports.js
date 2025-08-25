"use strict";
import path from "path";

// The file from which we wish to discourage importing values
const configFilePath = path.resolve(import.meta.dirname, "../src/common/config.js");

// Files that are allowed to import value exports from config.ts
const allowedConfigValueImportFiles = [
    // Main entry point that injects the config
    "src/index.ts",
    // Config resource definition that works with the some config values
    "src/resources/common/config.ts",
];

// Ref: https://eslint.org/docs/latest/extend/custom-rules
export default {
    meta: {
        type: "problem",
        docs: {
            description:
                "Disallows value imports from config.ts, with a few exceptions, to enforce dependency injection of the config.",
            recommended: true,
        },
        fixable: null,
        messages: {
            noConfigImports:
                "Value imports from config.ts are not allowed. Use dependency injection instead. Only type imports are permitted.",
        },
    },
    create(context) {
        const currentFilePath = path.resolve(context.getFilename());

        const isCurrentFileAllowedToImport = allowedConfigValueImportFiles.some((allowedFile) => {
            const resolvedAllowedFile = path.resolve(allowedFile);
            return currentFilePath === resolvedAllowedFile;
        });

        if (isCurrentFileAllowedToImport) {
            return {};
        }

        return {
            ImportDeclaration(node) {
                const importPath = node.source.value;

                // If the path is not relative, very likely its targeting a
                // node_module so we skip it. And also if the entire import is
                // marked with a type keyword.
                if (typeof importPath !== "string" || !importPath.startsWith(".") || node.importKind === "type") {
                    return;
                }

                const currentDir = path.dirname(currentFilePath);
                const resolvedImportPath = path.resolve(currentDir, importPath);

                if (resolvedImportPath === configFilePath) {
                    const hasValueImportFromConfig = node.specifiers.some((specifier) => {
                        return specifier.importKind !== "type";
                    });

                    if (hasValueImportFromConfig) {
                        context.report({
                            node,
                            messageId: "noConfigImports",
                        });
                    }
                }
            },
        };
    },
};
