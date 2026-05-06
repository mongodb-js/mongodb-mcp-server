import type { KnipConfig } from "knip";

const config: KnipConfig = {
    workspaces: {
        ".": {
            entry: [
                "src/index.ts!",
                "src/lib.ts!",
                "src/web.ts!",
                "src/tools/index.ts!",
                "tests/**/*.ts",
                "!tests/browser/**",
                "scripts/**/*.ts",
                "eslint-rules/*.js",
            ],
            ignore: ["tests/integration/fixtures/curl.mjs", "tests/vitest.d.ts"],
            ignoreDependencies: [
                "@mongodb-js/atlas-local",
                "@emotion/css",
                "@leafygreen-ui/table",
                // These are used by @mongodb-js/mcp-tools-mongodb package, keep for transitive dependency resolution
                "@mongodb-js/device-id",
                "mongodb",
                "mongodb-build-info",
                "mongodb-connection-string-url",
                "mongodb-schema",
                "node-machine-id",
            ],
        },
        "packages/ui": {
            entry: ["src/index.ts!"],
            ignore: ["src/build/mount.tsx", "src/test-setup.ts", "src/components/**", "vite.ui.config.ts"],
            ignoreDependencies: ["@lg-mcp/embeddable-uis", "@lg-mcp/hooks"],
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
        "tests/browser": {
            entry: ["tests/**/*.ts", "polyfills/**/*.ts", "utils/**/*.ts", "vitest.config.ts", "setup.ts"],
        },
    },
    ignoreExportsUsedInFile: true,
};

export default config;
