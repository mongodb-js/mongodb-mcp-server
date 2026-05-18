import { coverageConfigDefaults, defineConfig } from "vitest/config";

// Shared exclusions for all projects
// Ref: https://vitest.dev/config/#exclude
const vitestDefaultExcludes = [
    "**/node_modules/**",
    "**/dist/**",
    "**/cypress/**",
    "**/.{idea,git,cache,output,temp}/**",
    "**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build,eslint,prettier}.config.*",
];

const longRunningTests = ["packages/integration-tests/src/tools/atlas/performanceAdvisor.test.ts"];

if (process.env.SKIP_ATLAS_INTEGRATION_TESTS === "true") {
    vitestDefaultExcludes.push("**/integration/**/atlas/**");
}

if (process.env.SKIP_ATLAS_LOCAL_TESTS === "true") {
    vitestDefaultExcludes.push("**/atlas-local/**");
}

export default defineConfig({
    test: {
        environment: "node",
        pool: "threads",
        testTimeout: 3600000,
        hookTimeout: 3600000,
        setupFiles: ["./packages/test-utils/src/setup.ts"],
        coverage: {
            exclude: [
                // Required: import.meta.glob() in src/ui creates Vite virtual modules (\0 prefixed paths)
                // that crash Istanbul reporters. See: https://github.com/vitest-dev/vitest/issues/5101
                ...coverageConfigDefaults.exclude,
                "node_modules",
                "dist",
                "vitest.config.ts",
                "packages/scripts/src",
                "packages/mongodb-mcp-server/dist",
            ],
            reporter: ["lcov"],
        },
        projects: [
            {
                extends: true,
                test: {
                    name: "unit-and-integration",
                    include: ["packages/**/*.test.ts", "packages/mongodb-mcp-server/tests/**/*.test.ts"],
                    exclude: [
                        ...vitestDefaultExcludes,
                        "packages/scripts/**",
                        "packages/accuracy-tests/**",
                        "tests/browser/**",
                        ...longRunningTests,
                    ],
                },
            },
            {
                extends: true,
                test: {
                    name: "accuracy",
                    root: "./packages/accuracy-tests",
                    include: ["src/**/*.test.ts"],
                },
            },
            {
                extends: true,
                test: {
                    name: "eslint-rules",
                    include: ["eslint-rules/*.test.js"],
                },
            },
            {
                extends: true,
                test: {
                    name: "atlas-cleanup",
                    include: ["packages/scripts/src/cleanupAtlasTestLeftovers.test.ts"],
                },
            },
            {
                extends: true,
                test: {
                    name: "mcpb-build-script",
                    include: ["packages/scripts/src/createMcpb.test.ts"],
                },
            },
            {
                extends: true,
                test: {
                    name: "long-running-tests",
                    include: [...longRunningTests],
                    testTimeout: 7200000, // 2 hours for long-running tests
                    hookTimeout: 7200000,
                },
            },
            {
                test: {
                    name: "ui",
                    root: "./packages/ui",
                    environment: "happy-dom",
                    setupFiles: ["./src/test-setup.ts"],
                    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
                },
            },
        ],
    },
});
