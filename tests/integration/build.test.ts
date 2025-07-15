import { createRequire } from "module";
import path from "path";
import { describe, it, expect } from "vitest";

// Current directory where the test file is located
const currentDir = import.meta.dirname;

// Get project root (go up from tests/integration to project root)
const projectRoot = path.resolve(currentDir, "../..");

describe("Build Test", () => {
    it("should successfully require CommonJS module", () => {
        const require = createRequire(__filename);
        const cjsPath = path.resolve(projectRoot, "dist/cjs/lib.js");

        const cjsModule = require(cjsPath) as Record<string, unknown>;

        expect(cjsModule).toBeDefined();
        expect(typeof cjsModule).toBe("object");
    });

    it("should successfully import ESM module", async () => {
        const esmModule = (await import("../../dist/esm/lib.js")) as Record<string, unknown>;

        expect(esmModule).toBeDefined();
        expect(typeof esmModule).toBe("object");
    });

    it("should have matching exports between CommonJS and ESM modules", async () => {
        // Import CommonJS module
        const require = createRequire(__filename);
        const cjsPath = path.resolve(__dirname, "../../dist/cjs/lib.js");
        const cjsModule = require(cjsPath) as Record<string, unknown>;

        // Import ESM module
        const esmModule = (await import("../../dist/esm/lib.js")) as Record<string, unknown>;

        // Compare exports
        const cjsKeys = Object.keys(cjsModule).sort();
        const esmKeys = Object.keys(esmModule).sort();

        expect(cjsKeys).toEqual(esmKeys);
        expect(cjsKeys).toEqual(["Server", "Session", "Telemetry"]);
    });
});
