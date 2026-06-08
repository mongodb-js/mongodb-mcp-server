import { execFileSync } from "child_process";
import { createRequire } from "module";
import path from "path";
import { describe, it, expect } from "vitest";
import packageJson from "../../package.json" with { type: "json" };

// Current directory where the test file is located
const currentDir = import.meta.dirname;

// Get project root (go up from tests/integration to project root)
const projectRoot = path.resolve(currentDir, "../..");

const esmPath = path.resolve(projectRoot, "dist/esm/lib.js");
const cjsPath = path.resolve(projectRoot, "dist/cjs/lib.js");

const esmToolsPath = path.resolve(projectRoot, "dist/esm/tools/index.js");
const cjsToolsPath = path.resolve(projectRoot, "dist/cjs/tools/index.js");

const uiComponentBuildDependencies = ["@lg-mcp/embeddable-uis", "@lg-mcp/hooks", "react", "react-dom"];
const uiExports = ["UIRegistry"];

describe("Build Test", () => {
    it("should successfully require CommonJS module", () => {
        const require = createRequire(__filename);

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
        const require = createRequire(__filename);
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
                "Server",
                "Session",
                "StreamableHttpRunner",
                "Telemetry",
                "Elicitation",
            ])
        );
    });

    it("should have matching exports between CommonJS and ESM tools modules", async () => {
        // Import CommonJS module
        const require = createRequire(__filename);
        const cjsModule = require(cjsToolsPath) as Record<string, unknown>;

        // Import ESM module
        const esmModule = (await import(esmToolsPath)) as Record<string, unknown>;

        // Compare exports
        const cjsKeys = Object.keys(cjsModule).sort();
        const esmKeys = Object.keys(esmModule).sort();

        expect(cjsKeys).toEqual(esmKeys);
        // There are more tools but we will only check for a few.
        expect(cjsKeys).toEqual(expect.arrayContaining(["AllTools", "AggregateTool", "FindTool"]));
    });

    it("should keep bundled UI component packages out of server runtime dependencies", () => {
        for (const dependency of uiComponentBuildDependencies) {
            expect(packageJson.dependencies).not.toHaveProperty(dependency);
            expect(packageJson.devDependencies).toHaveProperty(dependency);
        }
    });

    it("should load the public UI registry module from ESM and CommonJS consumers", () => {
        const esmOutput = execFileSync(
            process.execPath,
            [
                "--input-type=module",
                "-e",
                "const mod = await import('mongodb-mcp-server/ui'); console.log(Object.keys(mod).sort().join(','));",
            ],
            { cwd: projectRoot, encoding: "utf8" }
        ).trim();
        const cjsOutput = execFileSync(
            process.execPath,
            ["-e", "const mod = require('mongodb-mcp-server/ui'); console.log(Object.keys(mod).sort().join(','));"],
            { cwd: projectRoot, encoding: "utf8" }
        ).trim();

        expect(cjsOutput.split(",")).toEqual(uiExports);
        expect(esmOutput.split(",")).toEqual(uiExports);
    });
});
