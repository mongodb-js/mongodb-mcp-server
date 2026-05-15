import type { KnipConfig } from "knip";

const config: KnipConfig = {
    // Shell built-ins used in package.json scripts
    ignoreBinaries: ["printf"],
    // Workspace-relative path in vitest.config.ts that knip can't resolve
    ignoreUnresolved: ["./src/test-setup.ts"],
    workspaces: {
        ".": {
            entry: [
                "src/index.ts!",
                "src/lib.ts!",
                "src/web.ts!",
                "src/tools/index.ts!",
                "tests/**/*.ts",
                "!tests/browser/**",
                "!packages/integration-tests/**",
                "eslint-rules/*.js",
            ],
            ignore: ["packaging/mcpb/server/index.js"],
            ignoreDependencies: [
                // Transitive deps needed for bundling/universal package
                "@emotion/css",
                "@anthropic-ai/mcpb",
                "@lg-mcp/embeddable-uis",
                "@lg-mcp/hooks",
                "@redocly/cli",
                "@types/yargs-parser",
                "@vitejs/plugin-react",
                "oauth4webapi",
                "openapi-fetch",
                "openapi-typescript",
                "openapi-typescript-helpers",
                "semver",
                "vite-plugin-node-polyfills",
                "vite-plugin-singlefile",
                // Transitive deps used by workspace packages
                "@mongodb-js/device-id",
                "mongodb",
                "mongodb-schema",
                "node-machine-id",
                // Dev tooling
                "vitest",
            ],
        },
        "packages/accuracy-tests": {
            entry: ["src/**/*.ts"],
            ignoreDependencies: [
                "mongodb-mcp-server",
                "@mongodb-js/mcp-core",
                "@mongodb-js/mcp-tools-assistant",
                "@mongodb-js/mcp-test-utils",
            ],
        },
        "packages/scripts": {
            entry: ["src/*.ts"],
            ignoreDependencies: [
                "vite", // Used as CLI in execSync, not as import
                "@mongodb-js/mcp-ui",
                "@mongodb-js/mcp-types",
                "@mongodb-js/mcp-metrics",
                "mongodb-mcp-server",
            ],
        },
        "packages/test-utils": {
            ignoreDependencies: ["@modelcontextprotocol/sdk", "@mongodb-js/mcp-ui", "vitest"],
        },
        "packages/integration-tests": {
            entry: ["src/**/*.ts"],
            ignore: ["src/fixtures/curl.mjs"],
        },
        "packages/ui": {
            ignore: ["src/build/mount.tsx", "src/components/**", "vite.ui.config.ts", "src/test-setup.ts"],
            ignoreDependencies: ["@lg-mcp/embeddable-uis", "@lg-mcp/hooks", "@testing-library/jest-dom/vitest"],
        },
        // Type-only package — deps are used via `import type` so knip can't detect runtime usage
        "packages/types": {
            ignoreDependencies: ["@modelcontextprotocol/sdk", "mongodb-redact"],
        },
        // Setup package is maintained in a separate worktree
        "packages/setup": {
            ignore: ["**/*"],
        },
        "packages/http-transports": {
            entry: ["src/index.ts!"],
        },
        "packages/tools-mongodb": {
            ignoreDependencies: [
                // Dependencies used by this package but knip can't detect all patterns
                "@mongodb-js/device-id",
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
            entry: ["tests/**/*.ts", "polyfills/**/*.ts", "utils/**/*.ts", "setup.ts"],
            ignoreDependencies: ["buffer", "evp_bytestokey", "util", "@vitest/browser"],
            ignore: ["polyfills/events/index.ts"], // Has both named and default export intentionally
        },
    },
    ignoreExportsUsedInFile: true,
};

export default config;
