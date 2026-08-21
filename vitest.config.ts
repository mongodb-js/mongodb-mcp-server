import { coverageConfigDefaults, defineConfig } from "vitest/config";

// Shared exclusions for all projects
// Ref: https://vitest.dev/config/#exclude
const vitestDefaultExcludes = [
    "**/node_modules/**",
    "**/dist/**",
    "**/cypress/**",
    "**/.{idea,git,cache,output,temp}/**",
    // Agent worktrees contain full repo copies whose tests would otherwise be
    // picked up by the unanchored include globs and race over fixed ports.
    "**/.claude/**",
    "**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build,eslint,prettier}.config.*",
];

// Tests provisioned against real Atlas infrastructure on cloud-dev. They are
// excluded from unit-and-integration and instead run in their own dedicated
// projects (long-running-tests for performanceAdvisor, streams-tests for the
// streams suites sharing one provisioned workspace, clusters-tests for the
// suites that provision real clusters).
const longRunningTests = [
    "packages/integration-tests/src/tools/atlas/performanceAdvisor.test.ts",
    "packages/integration-tests/src/tools/atlas/streams/**/*.test.ts",
];

const atlasStreamsTests = "packages/integration-tests/src/tools/atlas/streams/**/*.test.ts";

const atlasClusterTests = [
    "packages/integration-tests/src/tools/atlas/clusters.test.ts",
    "packages/integration-tests/src/tools/atlas/sampleDataset.test.ts",
];

if (process.env.SKIP_ATLAS_INTEGRATION_TESTS === "true") {
    vitestDefaultExcludes.push("**/integration-tests/**/atlas/**");
}

if (process.env.SKIP_ATLAS_LOCAL_TESTS === "true") {
    vitestDefaultExcludes.push("**/integration-tests/**/atlas-local/**");
}

export default defineConfig({
    test: {
        environment: "node",
        testTimeout: 3600000,
        hookTimeout: 3600000,
        setupFiles: ["./packages/test-utils/src/setup.ts"],
        coverage: {
            // Coverage is disabled on Windows as we only report it from the ubuntu job
            enabled: process.platform !== "win32",
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
                    include: ["packages/**/*.test.ts"],
                    exclude: [
                        ...vitestDefaultExcludes,
                        "packages/scripts/**",
                        "packages/accuracy-tests/**",
                        "packages/browser-tests/**",
                        ...longRunningTests,
                        ...atlasClusterTests,
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
                    name: "long-running-tests",
                    include: ["packages/integration-tests/src/tools/atlas/performanceAdvisor.test.ts"],
                    testTimeout: 7200000, // 2 hours for long-running tests
                    hookTimeout: 7200000,
                },
            },
            {
                extends: true,
                test: {
                    name: "clusters-tests",
                    include: [...atlasClusterTests],
                    testTimeout: 7200000, // 2 hours for long-running tests
                    hookTimeout: 7200000,
                },
            },
            {
                extends: true,
                test: {
                    name: "streams-tests",
                    include: [atlasStreamsTests],
                    testTimeout: 7200000, // 2 hours for long-running tests
                    hookTimeout: 7200000,
                    // Provision ONE shared Atlas project + streams workspace + cluster for
                    // the whole run and make it available to every streams test file via
                    // inject("atlasStreamsWorkspace"). See streamsGlobalSetup.ts.
                    globalSetup: ["./packages/integration-tests/src/tools/atlas/streamsGlobalSetup.ts"],
                    // Streams test files share a single mutable workspace (processors,
                    // connections, tier changes), so run files one at a time instead of
                    // in parallel workers.
                    fileParallelism: false,
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
