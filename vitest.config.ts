import { defineConfig } from "vitest/config";

// Shared exclusions for all projects
// Ref: https://vitest.dev/config/#exclude
const vitestDefaultExcludes = [
    "**/node_modules/**",
    "**/dist/**",
    "**/cypress/**",
    "**/.{idea,git,cache,output,temp}/**",
    "**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build,eslint,prettier}.config.*",
];

export default defineConfig({
    test: {
        environment: "node",
        testTimeout: 3600000,
        hookTimeout: 3600000,
        setupFiles: ["./tests/setup.ts"],
        coverage: {
            exclude: ["node_modules", "tests", "dist", "vitest.config.ts", "scripts"],
            reporter: ["lcov"],
        },
        projects: [
            {
                extends: true,
                test: {
                    name: "unit-and-integration",
                    include: ["**/*.test.ts"],
                    exclude: [...vitestDefaultExcludes, "tests/accuracy/**"],
                },
            },
            {
                extends: true,
                test: {
                    name: "accuracy",
                    include: ["**/accuracy/*.test.ts"],
                },
            },
        ],
    },
});
