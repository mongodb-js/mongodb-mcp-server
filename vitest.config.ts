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

// Whole packages handled by dedicated projects/executions (accuracy evals,
// browser e2e, ui, and packages with no unit tests).
const NON_UNIT_PACKAGES = [
    // Dedicated projects below handle these (accuracy/ui) or dedicated CI jobs
    // (browser e2e). eval-tests and scripts contain no unit tests to run, and
    // integration-tests is split into the integration projects.
    "packages/accuracy-tests/**",
    "packages/browser-tests/**",
    "packages/eval-tests/**",
    "packages/integration-tests/**",
    "packages/scripts/**",
    "packages/ui/**",
];

// ---------------------------------------------------------------------------
// Unit tests: package-internal tests in src/ that mock their dependencies and
// need no external infrastructure. New unit test files are picked up
// automatically by the src/** glob — no project edit needed.
// ---------------------------------------------------------------------------
const UNIT_INCLUDES = ["packages/*/src/**/*.test.ts"];

// ---------------------------------------------------------------------------
// Integration tests (packages/integration-tests) split by the infrastructure
// each suite needs. Each project is a directory glob so adding test files to
// those directories requires no project edits.
// ---------------------------------------------------------------------------

// Atlas suites provisioned against real Atlas infrastructure on cloud-dev.
// They are split across dedicated projects with tailored timeouts/setup:
//   - integration-atlas: the remaining atlas suites (fast, one project each)
//   - streams-tests: streams suites sharing ONE provisioned workspace
//   - clusters-tests: suites that provision real clusters (M0, slow)
//   - long-running-tests: performanceAdvisor (2h, separate workflow)
const INTEGRATION_ATLAS_INCLUDES = ["packages/integration-tests/src/tools/atlas/**/*.test.ts"];

const ATLAS_STREAMS_TESTS = "packages/integration-tests/src/tools/atlas/streams/**/*.test.ts";

const ATLAS_CLUSTER_TESTS = [
    "packages/integration-tests/src/tools/atlas/clusters.test.ts",
    "packages/integration-tests/src/tools/atlas/sampleDataset.test.ts",
];

// Atlas Local via Docker (skips on macOS GitHub runners without Docker).
const INTEGRATION_ATLAS_LOCAL_INCLUDES = ["packages/integration-tests/src/tools/atlas-local/**/*.test.ts"];

// Everything else in integration-tests: the MCP server/session/transport/config
// suites exercised in process with mocks, AND the MongoDB tool suites that spin
// up a real MongoDBClusterProcess locally (self-skipping when the environment
// cannot host one). New integration test files that are not Atlas-bound join
// here automatically.
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
                    exclude: [...vitestDefaultExcludes, ATLAS_STREAMS_TESTS, ...ATLAS_CLUSTER_TESTS, ...LONG_RUNNING_TESTS],
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
                    include: [ATLAS_STREAMS_TESTS],
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
