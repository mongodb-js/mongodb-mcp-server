import type { KnipConfig } from "knip";

const config: KnipConfig = {
    workspaces: {
        ".": {
            entry: [
                "src/index.ts!",
                "src/lib.ts!",
                "src/web.ts!",
                "src/tools/index.ts!",
                "src/ui/index.ts!",
                "tests/**/*.ts",
                "!tests/browser/**",
                "scripts/**/*.ts",
                "eslint-rules/*.js",
                "vite.ui.config.ts",
            ],
            ignore: [
                "tests/integration/fixtures/curl.mjs",
                "tests/vitest.d.ts",
                "src/ui/build/mount.tsx",
                "src/ui/components/**/*.ts",
                "src/ui/components/**/*.tsx",
                "src/ui/hooks/**/*.ts",
                "src/ui/registry/uiMap.ts",
                "src/ui/lib/tools/**/*.ts",
                "src/ui/lib/loaders.ts",
                "packaging/mcpb/server/index.js",
                "dist/**",
                "packages/*/dist/**",
                "packages/ui/src/test-setup.ts",
            ],
            ignoreDependencies: [
                "@mongodb-js/atlas-local",
                "@emotion/css",
                "@leafygreen-ui/table",
                "@mongodb-js/mcp-tools-mongodb",
                "react",
                "react-dom",
                "@anthropic-ai/mcpb",
                "@lg-mcp/embeddable-uis",
                "@lg-mcp/hooks",
                "@redocly/cli",
                "@types/yargs-parser",
                "@vitejs/plugin-react",
                "openapi-typescript",
                "openapi-typescript-helpers",
                "semver",
                "vite-plugin-node-polyfills",
                "vite-plugin-singlefile",
            ],
        },
        "packages/ui": {
            entry: ["src/index.ts!"],
            ignore: ["src/build/mount.tsx", "src/test-setup.ts", "src/components/**", "vite.ui.config.ts", "dist/**"],
            ignoreDependencies: ["@lg-mcp/embeddable-uis", "@lg-mcp/hooks", "@testing-library/jest-dom/vitest"],
        },
        // Type-only package — deps are used via `import type` so knip can't detect runtime usage
        "packages/types": {
            ignoreDependencies: ["@modelcontextprotocol/sdk", "mongodb-redact"],
        },
        "packages/tools-mongodb": {
            ignoreDependencies: [
                "@mongodb-js/device-id",
                "@mongodb-js/mcp-core",
                "@mongodb-js/mcp-logging",
                "@mongodb-js/mcp-types",
                "@mongosh/arg-parser",
                "@mongosh/service-provider-node-driver",
                "bson",
                "mongodb",
                "mongodb-build-info",
                "mongodb-connection-string-url",
                "mongodb-schema",
                "node-machine-id",
                "zod",
            ],
        },
        "packages/scripts": {
            ignoreDependencies: ["vite"],
        },
        "tests/browser": {
            entry: ["tests/**/*.ts", "polyfills/**/*.ts", "utils/**/*.ts", "vitest.config.ts", "setup.ts"],
            ignoreDependencies: ["buffer", "evp_bytestokey", "util", "@vitest/browser"],
        },
    },
    ignoreExportsUsedInFile: true,
};

export default config;
