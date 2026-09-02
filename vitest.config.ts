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

const NON_UNIT_PACKAGES = [
    "packages/accuracy-tests/**",
    "packages/browser-tests/**",
    "packages/e2e-tests/**",
    "packages/eval-tests/**",
    "packages/integration-tests/**",
    "packages/scripts/**",
    "packages/ui/**",
];

const UNIT_INCLUDES = ["packages/*/src/**/*.test.ts"];

const INTEGRATION_ATLAS_INCLUDES = ["packages/integration-tests/src/tools/atlas/**/*.test.ts"];

const ATLAS_STREAMS_TESTS = ["packages/integration-tests/src/tools/atlas/streams/**/*.test.ts"];

const ATLAS_CLUSTER_TESTS = [
    "packages/integration-tests/src/tools/atlas/clusters.test.ts",
    "packages/integration-tests/src/tools/atlas/sampleDataset.test.ts",
];

const INTEGRATION_ATLAS_LOCAL_INCLUDES = ["packages/integration-tests/src/tools/atlas-local/**/*.test.ts"];

const INTEGRATION_INCLUDES = ["packages/integration-tests/src/**/*.test.ts"];

const INTEGRATION_ATLAS_EXCLUDES = [
    ...INTEGRATION_ATLAS_INCLUDES,
    ...INTEGRATION_ATLAS_LOCAL_INCLUDES,
    ...ATLAS_STREAMS_TESTS,
    ...ATLAS_CLUSTER_TESTS,
];

const LONG_RUNNING_TESTS = ["packages/integration-tests/src/tools/atlas/performanceAdvisor.test.ts"];

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
                    name: "unit",
                    include: UNIT_INCLUDES,
                    exclude: [...vitestDefaultExcludes, ...NON_UNIT_PACKAGES],
                },
            },
            {
                extends: true,
                test: {
                    name: "integration",
                    include: INTEGRATION_INCLUDES,
                    exclude: [...vitestDefaultExcludes, ...INTEGRATION_ATLAS_EXCLUDES, ...LONG_RUNNING_TESTS],
                },
            },
            {
                extends: true,
                test: {
                    name: "integration-atlas",
                    include: INTEGRATION_ATLAS_INCLUDES,
                    exclude: [
                        ...vitestDefaultExcludes,
                        ...ATLAS_STREAMS_TESTS,
                        ...ATLAS_CLUSTER_TESTS,
                        ...LONG_RUNNING_TESTS,
                    ],
                },
            },
            {
                extends: true,
                test: {
                    name: "e2e-tests",
                    include: ["packages/e2e-tests/src/**/*.test.ts"],
                    // A single codex run can take minutes; multiple concurrent
                    // harness sessions would multiply LLM cost and mongod instances.
                    testTimeout: 20 * 60 * 1000,
                    hookTimeout: 20 * 60 * 1000,
                    fileParallelism: false,
                    maxWorkers: 1,
                },
            },
            {
                extends: true,
                test: {
                    name: "clusters-tests",
                    include: [...ATLAS_CLUSTER_TESTS],
                    testTimeout: 7200000, // 2 hours for long-running tests
                    hookTimeout: 7200000,
                },
            },
            {
                extends: true,
                test: {
                    name: "streams-tests",
                    include: ATLAS_STREAMS_TESTS,
                    testTimeout: 7200000, // 2 hours for long-running tests
                    hookTimeout: 7200000,
                    globalSetup: ["./packages/integration-tests/src/tools/atlas/streamsGlobalSetup.ts"],
                    fileParallelism: false,
                },
            },
            {
                extends: true,
                test: {
                    name: "integration-atlas-local",
                    include: INTEGRATION_ATLAS_LOCAL_INCLUDES,
                    exclude: [...vitestDefaultExcludes],
                },
            },
            {
                extends: true,
                test: {
                    name: "long-running-tests",
                    include: [...LONG_RUNNING_TESTS],
                    testTimeout: 7200000, // 2 hours for long-running tests
                    hookTimeout: 7200000,
                },
            },
            {
                extends: true,
                test: {
                    name: "accuracy",
                    include: ["packages/accuracy-tests/src/**/*.test.ts"],
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
