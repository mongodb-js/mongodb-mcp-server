import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { describe, expect, it } from "vitest";
import packageJson from "../../package.json" with { type: "json" };

const execFileAsync = promisify(execFile);
const CLI_PATH = path.join(import.meta.dirname, "..", "..", "dist", "index.js");

describe("CLI entrypoint", () => {
    it("should handle version request", async () => {
        const { stdout, stderr } = await execFileAsync(process.execPath, [CLI_PATH, "--version"]);
        expect(stdout).toContain(packageJson.version);
        expect(stderr).toEqual("");
    });

    it("should handle help request", async () => {
        const { stdout, stderr } = await execFileAsync(process.execPath, [CLI_PATH, "--help"]);
        expect(stdout).toContain("For usage information refer to the README.md");
        expect(stderr).toEqual("");
    });

    it("should handle dry run request", async () => {
        const { stdout, stderr } = await execFileAsync(process.execPath, [CLI_PATH, "--dryRun"]);
        expect(stdout).toContain("Configuration:");
        expect(stdout).toContain("Enabled tools:");
        expect(stderr).toEqual("");
    });
});
