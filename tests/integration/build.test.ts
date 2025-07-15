import { createRequire } from "module";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { describe, it, expect } from "vitest";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("Build Test", () => {
    it("should successfully require CommonJS module", () => {
        const require = createRequire(__filename);
        const cjsPath = path.resolve(__dirname, "../../dist/cjs/lib.js");

        const cjsModule = require(cjsPath) as Record<string, unknown>;

        expect(cjsModule).toBeDefined();
        expect(typeof cjsModule).toBe("object");
    });

    it("should successfully import ESM module", async () => {
        const esmPath = path.resolve(__dirname, "../../dist/lib.js");
        const esmFileURL = pathToFileURL(esmPath).href;

        const esmModule = (await import(esmFileURL)) as Record<string, unknown>;

        expect(esmModule).toBeDefined();
        expect(typeof esmModule).toBe("object");
    });

    it("should have matching exports between CommonJS and ESM modules", async () => {
        // Import CommonJS module
        const require = createRequire(__filename);
        const cjsPath = path.resolve(__dirname, "../../dist/cjs/lib.js");
        const cjsModule = require(cjsPath) as Record<string, unknown>;

        // Import ESM module
        const esmPath = path.resolve(__dirname, "../../dist/lib.js");
        const esmFileURL = pathToFileURL(esmPath).href;
        const esmModule = (await import(esmFileURL)) as Record<string, unknown>;

        // Compare exports
        const cjsKeys = Object.keys(cjsModule).sort();
        const esmKeys = Object.keys(esmModule).sort();

        expect(cjsKeys).toEqual(esmKeys);
        expect(cjsKeys).toEqual(["Server", "Session", "Telemetry"]);
    });
});
