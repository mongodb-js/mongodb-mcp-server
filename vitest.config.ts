import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        environment: "node",
        testTimeout: 3600000,
        hookTimeout: 3600000,
        include: ["**/*.test.ts"],
        setupFiles: ["./tests/setup.ts"],
        coverage: {
            exclude: ["node_modules", "tests", "dist"],
            reporter: ["lcov"],
        },
    },
});
