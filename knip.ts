{
  "workspaces": {
    ".": {
      "entry": [
        "src/index.ts!",
        "src/lib.ts!",
        "src/web.ts!",
        "src/tools/index.ts!",
        "src/ui/index.ts!",
        "tests/**/*.ts",
        "!tests/browser/**",
        "scripts/**/*.ts",
        "eslint-rules/*.js",
        "vite.ui.config.ts"
      ],
      "ignore": [
        "tests/eval/scripts/bundleEval/osDnsNativeStub.cjs",
        "tests/eval/scripts/bundleEval/stub.mjs",
        "tests/integration/fixtures/curl.mjs",
        "tests/vitest.d.ts",
        "src/ui/build/mount.tsx",
        "src/ui/components/**/*.ts",
        "src/ui/components/**/*.tsx",
        "src/ui/hooks/**/*.ts",
        "src/ui/registry/uiMap.ts",
        "src/ui/lib/tools/**/*.ts",
        "src/ui/lib/loaders.ts",
        "packaging/mcpb/server/index.js"
      ],
      "ignoreDependencies": [
        "@mongodb-js/atlas-local",
        "@emotion/css",
        "@leafygreen-ui/table",
        "react",
        "react-dom"
      ]
    },
    "packages/mongodb-atlas-mcp-remote": {
      "entry": [
        "src/cli.ts!",
        "scripts/**/*.ts",
        "src/**/*.test.ts",
        "src/testHelpers/**/*.ts"
      ]
    },
    "tests/browser": {
      "entry": [
        "tests/**/*.ts",
        "polyfills/**/*.ts",
        "utils/**/*.ts",
        "vitest.config.ts",
        "setup.ts"
      ]
    }
  },
  "ignoreExportsUsedInFile": true
}
