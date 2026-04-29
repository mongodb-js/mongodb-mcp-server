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
            ],
            ignoreDependencies: [
                "@mongodb-js/atlas-local",
                "@emotion/css",
                "@leafygreen-ui/table",
                "react",
                "react-dom",
            ],
        },
        // Type-only package — deps are used via `import type` so knip can't detect runtime usage
        "packages/types": {
            ignoreDependencies: ["@modelcontextprotocol/sdk", "mongodb-redact"],
        },
        "tests/browser": {
            entry: [
                "tests/**/*.ts",
                "polyfills/**/*.ts",
                "utils/**/*.ts",
                "vitest.config.ts",
                "setup.ts",
            ],
        },
    },
    ignoreExportsUsedInFile: true,
};

export default config;
