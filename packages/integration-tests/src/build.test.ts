import { createRequire } from "module";
import path from "path";
import { describe, it, expect } from "vitest";

// Current directory where the test file is located
const currentDir = import.meta.dirname;

// Get project root (go up from packages/integration-tests/src to project root)
const projectRoot = path.resolve(currentDir, "../../..");

const esmPath = path.resolve(projectRoot, "packages/mongodb-mcp-server/dist/esm/lib.js");
const cjsPath = path.resolve(projectRoot, "packages/mongodb-mcp-server/dist/cjs/lib.js");

describe("Build Test", () => {
    it("should successfully require CommonJS module", () => {
        // Use the CJS directory path for createRequire to ensure proper module context
        const require = createRequire(cjsPath);

        const cjsModule = require(cjsPath) as Record<string, unknown>;

        expect(cjsModule).toBeDefined();
        expect(typeof cjsModule).toBe("object");
    });

    it("should successfully import ESM module", async () => {
        const esmModule = (await import(esmPath)) as Record<string, unknown>;

        expect(esmModule).toBeDefined();
        expect(typeof esmModule).toBe("object");
    });

    it("should have matching exports between CommonJS and ESM modules", async () => {
        // Import CommonJS module
        // Use the CJS directory path for createRequire to ensure proper module context
        const require = createRequire(cjsPath);
        const cjsModule = require(cjsPath) as Record<string, unknown>;

        // Import ESM module
        const esmModule = (await import(esmPath)) as Record<string, unknown>;

        // Compare exports
        const cjsKeys = Object.keys(cjsModule).sort();
        const esmKeys = Object.keys(esmModule).sort();

        expect(cjsKeys).toEqual(esmKeys);
        expect(cjsKeys).toEqual(
            expect.arrayContaining([
                "ConnectionManager",
                "LoggerBase",
                "CliServer",
                "CliSession",
                "StreamableHttpRunner",
                "AtlasTelemetry",
                "Elicitation",
            ])
        );
    });
});
