import path from "path";

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
        schema: [
            {
                type: "object",
                properties: {
                    configFilePath: {
                        type: "string",
                        description: "Path to the config file to restrict.",
                    },
                    allowedFiles: {
                        type: "array",
                        items: { type: "string" },
                        description: "List of file paths that are allowed to import value exports from config.ts.",
                    },
                },
                required: ["configFilePath"],
            },
        ],
        messages: {
            noConfigImports:
                "Value imports from config.ts are not allowed. Use dependency injection instead. Only type imports are permitted.",
        },
    },
    create(context) {
        const options = context.options[0];
        if (!options) {
            throw new Error(
                "no-config-imports should be configured with an object with at-least 'configFilePath' key."
            );
        }
        const configFilePath = path.resolve(options.configFilePath);
        const allowedFiles = options.allowedFiles || [];

        const currentFilePath = path.resolve(context.getFilename());

        const isCurrentFileAllowedToImport = allowedFiles.some((allowedFile) => {
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
