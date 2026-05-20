import type { KnipConfig } from "knip";

const config: KnipConfig = {
    // Shell built-ins used in package.json scripts
    ignoreBinaries: ["printf"],
    // Resolved at runtime relative to the ui vitest project root
    ignoreUnresolved: ["./src/test-setup.ts"],
    workspaces: {
        ".": {
            entry: ["eslint-rules/*.js"],
            ignoreDependencies: [
                // Used by workspace packages via generation scripts, listed at root for hoisting
                "@emotion/css",
                "@anthropic-ai/mcpb",
                "@lg-mcp/embeddable-uis",
                "@lg-mcp/hooks",
                "@redocly/cli",
                "@types/yargs-parser",
                "@vitejs/plugin-react",
                "oauth4webapi",
                "openapi-typescript",
                "openapi-typescript-helpers",
                "vite-plugin-node-polyfills",
                "vite-plugin-singlefile",
                "@testing-library/jest-dom",
                "@types/express",
                "@microsoft/api-extractor",
            ],
        },
        "packages/mongodb-mcp-server": {
            entry: [
                "src/index.ts!",
                "src/lib.ts!",
                "src/allTools.ts!",
                "src/web.ts!",
                "src/tools/index.ts!",
                "src/test-helpers/index.ts!",
                "e2e-tests/**/*.ts",
                "scripts/**/*.ts",
                "packaging/mcpb/server/index.js",
            ],
            ignoreDependencies: [
                // Re-exported through tools; knip does not trace the full chain
                "@mongosh/service-provider-node-driver",
                // Re-exported as `export type { Secret }`; knip --strict ignores type-only usage
                "mongodb-redact",
            ],
        },
        "packages/scripts": {
            entry: ["src/*.ts"],
            ignoreDependencies: [
                "vite", // Used as CLI in execSync, not as import
            ],
        },
        "packages/test-utils": {
            entry: ["src/setup.ts", "scripts/copy-assets.js"],
        },
        "packages/accuracy-tests": {
            entry: ["src/**/*.ts"],
        },
        "packages/integration-tests": {
            entry: ["src/index.ts", "src/**/*.ts"],
            ignore: ["src/fixtures/curl.mjs"],
        },
        "packages/atlas-api-client": {
            entry: ["src/**/*.test.ts"],
            ignore: ["openapi.d.ts"], // Generated file with many exported types
        },
        "packages/core": {
            entry: ["src/index.ts!", "src/**/*.test.ts"],
        },
        "packages/http-runners": {
            entry: ["src/**/*.test.ts"],
        },
        "packages/tools-atlas-local": {
            entry: ["src/**/*.test.ts"],
        },
        "packages/ui": {
            entry: ["src/test-setup.ts"],
            ignore: ["src/build/mount.tsx", "src/components/**", "vite.ui.config.ts"],
        },
        // Published type re-exports; knip --strict does not count `import type` as usage
        "packages/types": {
            ignoreDependencies: ["@modelcontextprotocol/sdk", "mongodb-redact"],
        },
        // Setup package is maintained in a separate worktree
        "packages/setup": {
            ignore: ["**/*"],
        },
        "packages/cli": {
            entry: ["src/**/*.test.ts"],
        },
        "packages/tools-mongodb": {
            entry: ["src/**/*.test.ts"],
        },
        "tests/browser": {
            entry: ["tests/**/*.ts", "polyfills/**/*.ts", "utils/**/*.ts", "setup.ts"],
            ignoreDependencies: ["buffer", "evp_bytestokey", "util", "@vitest/browser"],
            ignore: ["polyfills/events/index.ts"], // Has both named and default export intentionally
        },
    },
    ignoreExportsUsedInFile: true,
};

export default config;
