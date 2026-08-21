import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        environment: "happy-dom",
        setupFiles: ["./src/test-setup.ts"],
        include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    },
});
