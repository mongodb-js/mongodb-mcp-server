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
                "src/ui/index.ts!",
                "tests/**/*.ts",
                "!tests/browser/**",
                "scripts/**/*.ts",
                "eslint-rules/*.js",
                "vite.ui.config.ts",
                "vitest.config.ts",
            ],
            ignore: [
                "packages/atlas-api-client/openapi.d.ts",
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
                // Referenced in vitest.config.ts with workspace-relative path
                "./src/test-setup.ts",
            ],
            ignoreDependencies: [
                // Transitive deps needed for bundling/universal package
                "@mongodb-js/atlas-local",
                "@mongodb-js/device-id",
                "@emotion/css",
                "@leafygreen-ui/table",
                "react",
                "react-dom",
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
            ],
        },
        "packages/accuracy-tests": {
            entry: [
                "src/sdk/**/*.ts",
                "src/generateTestSummary.ts",
                "src/updateAccuracyRunStatus.ts",
                "src/unit/**/*.ts",
            ],
        },
        "packages/scripts": {
            entry: ["src/*.ts"],
            ignoreDependencies: ["vite"], // Used as CLI in execSync, not as import
        },
        "packages/test-utils": {
            entry: ["src/index.ts!"],
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
            ignoreDependencies: ["buffer", "evp_bytestokey", "util", "@vitest/browser"],
            ignore: ["polyfills/events/index.ts"], // Has both named and default export intentionally
        },
    },
    ignoreExportsUsedInFile: true,
};

export default config;
