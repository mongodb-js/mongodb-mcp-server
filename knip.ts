import type { KnipConfig } from "knip";

const config: KnipConfig = {
    // Shell built-ins used in package.json scripts
    ignoreBinaries: ["printf"],
    // This path is referenced in vitest.config.ts but resolved at runtime
    ignoreUnresolved: ["./src/test-setup.ts"],
    workspaces: {
        ".": {
            entry: [
                "src/index.ts!",
                "src/lib.ts!",
                "src/web.ts!",
                "src/tools/index.ts!",
                "src/setup/index.ts!",
                "src/test-helpers/index.ts!",
                "tests/**/*.ts",
                "!tests/browser/**",
                "!packages/**", // Each package has its own knip workspace config
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
                // Peer deps required by mongosh packages but not directly imported
                "@mongodb-js/device-id",
                "mongodb",
                "mongodb-schema",
                "node-machine-id",
                // Dev tooling - not imported but used via CLI
                "vitest",
                // Test assertion library - extended via vitest setup, not imported
                "@testing-library/jest-dom",
                // Express types - needed for middleware but not directly imported
                "@types/express",
            ],
        },
        "packages/scripts": {
            entry: ["src/*.ts"],
            ignoreDependencies: [
                "vite", // Used as CLI in execSync, not as import
                // Used in generateToolDocumentation.ts for UI and metrics
                "@mongodb-js/mcp-ui",
                "@mongodb-js/mcp-types",
                "@mongodb-js/mcp-metrics",
                // Used for UserConfigSchema and tools imports
                "mongodb-mcp-server",
            ],
        },
        "packages/test-utils": {
            entry: ["src/index.ts", "src/setup.ts"],
        },
        "packages/accuracy-tests": {
            entry: ["src/**/*.ts"],
        },
        "packages/integration-tests": {
            entry: ["src/index.ts", "src/**/*.ts"],
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
            // These are used via mongosh and driver peer dependencies
            // but knip can't trace through the complex import chains
            ignoreDependencies: [
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
