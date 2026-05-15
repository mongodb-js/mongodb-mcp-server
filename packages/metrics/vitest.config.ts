import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        setupFiles: ["../test-utils/src/setup.ts"],
    },
});
