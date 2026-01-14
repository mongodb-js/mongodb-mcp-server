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

if (process.env.SKIP_ATLAS_TESTS === "true") {
    vitestDefaultExcludes.push("**/atlas/**");
}

if (process.env.SKIP_ATLAS_LOCAL_TESTS === "true") {
    vitestDefaultExcludes.push("**/atlas-local/**");
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
                    exclude: [...vitestDefaultExcludes, "scripts/**", "tests/accuracy/**", ...longRunningTests],
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
