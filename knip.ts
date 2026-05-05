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
            ignore: [
                "tests/integration/fixtures/curl.mjs",
                "tests/vitest.d.ts",
                "src/tools/args.ts",
                "src/common/errors.ts",
            ],
            ignoreDependencies: ["@mongodb-js/atlas-local", "@emotion/css", "@leafygreen-ui/table", "mongodb-schema"],
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
            // args.ts exports CommonArgs for future use but not currently used internally
            ignore: ["src/args.ts"],
            // These are used via the connectionManager and other internal modules
            ignoreDependencies: [
                "@mongodb-js/device-id",
                "@mongodb-js/devtools-proxy-support",
                "mongodb-redact",
                "node-machine-id",
            ],
        },
        "tests/browser": {
            entry: ["tests/**/*.ts", "polyfills/**/*.ts", "utils/**/*.ts", "vitest.config.ts", "setup.ts"],
        },
    },
    ignoreExportsUsedInFile: true,
};

export default config;
