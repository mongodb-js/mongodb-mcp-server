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

const longRunningTests = ["tests/integration/tools/atlas/performanceAdvisor.test.ts"];

if (process.env.SKIP_ATLAS_INTEGRATION_TESTS === "true") {
    vitestDefaultExcludes.push("**/integration/**/atlas/**");
}

if (process.env.SKIP_ATLAS_LOCAL_TESTS === "true") {
    vitestDefaultExcludes.push("**/atlas-local/**");
}

// TODO: Re-enable on Windows once the worker fork crash is resolved.
// The aggregate test file's Vitest worker exits unexpectedly on Windows runners,
// leaving an orphan mongod and failing the whole run with exit code 1.
if (process.platform === "win32") {
    vitestDefaultExcludes.push("**/integration/tools/mongodb/read/aggregate.test.ts");
}

export default defineConfig({
    test: {
        environment: "node",
        testTimeout: 3600000,
        hookTimeout: 3600000,
        setupFiles: ["./tests/setup.ts"],
        coverage: {
            exclude: [
                // Required: import.meta.glob() in src/ui creates Vite virtual modules (\0 prefixed paths)
                // that crash Istanbul reporters. See: https://github.com/vitest-dev/vitest/issues/5101
                ...coverageConfigDefaults.exclude,
                "node_modules",
                "tests",
                "dist",
                "vitest.config.ts",
                "vite.ui.config.ts",
                "scripts",
                "src/ui/lib",
            ],
            reporter: ["lcov"],
        },
        projects: [
            {
                extends: true,
                test: {
                    name: "unit-and-integration",
                    include: ["**/*.test.ts"],
                    exclude: [
                        ...vitestDefaultExcludes,
                        "scripts/**",
                        "tests/accuracy/**",
                        "tests/browser/**",
                        ...longRunningTests,
                    ],
                },
            },
            {
                extends: true,
                test: {
                    name: "accuracy",
                    include: ["**/accuracy/*.test.ts"],
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
                    include: ["scripts/cleanupAtlasTestLeftovers.test.ts"],
                },
            },
            {
                extends: true,
                test: {
                    name: "mcpb-build-script",
                    include: ["scripts/createMcpb.test.ts"],
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
                extends: true,
                test: {
                    name: "ui-components",
                    include: ["tests/unit/ui/**/*.test.tsx"],
                    environment: "happy-dom",
                    setupFiles: ["./tests/setup.ts", "./tests/setupReact.ts"],
                },
            },
        ],
    },
});
