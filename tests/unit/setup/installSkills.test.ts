import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest";
import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";

vi.mock("node:child_process", () => ({
    spawn: vi.fn(),
}));

vi.mock("@inquirer/prompts", () => ({
    confirm: vi.fn(),
}));

import { spawn } from "node:child_process";
import { confirm } from "@inquirer/prompts";
import { buildSkillsAddArgs, installSkills, promptAndInstallSkills } from "../../../src/setup/installSkills.js";

const spawnMock = vi.mocked(spawn);
const confirmMock = vi.mocked(confirm);

/**
 * Produce a fake ChildProcess that emits a `close` event with the given exit code
 * on the next tick. Lets us drive installSkills without a real subprocess. The
 * `ChildProcess` cast is safe because `installSkills` only reads `close`/`error`
 * events off the return value.
 */
function fakeChildProcess(exitCode: number): ChildProcess {
    const emitter = new EventEmitter();
    // Match real node `close` semantics: `(code, signal)` where exactly one is non-null.
    setImmediate(() => emitter.emit("close", exitCode, null));
    return emitter as unknown as ChildProcess;
}

/** Simulate a subprocess killed by a signal — close fires with code=null, signal set. */
function fakeChildProcessKilled(signal: NodeJS.Signals): ChildProcess {
    const emitter = new EventEmitter();
    setImmediate(() => emitter.emit("close", null, signal));
    return emitter as unknown as ChildProcess;
}

describe("buildSkillsAddArgs", () => {
    it("assembles args for the global skills install (always -g)", () => {
        const args = buildSkillsAddArgs("cursor");
        expect(args).toEqual(["--yes", "skills@1", "add", "mongodb/agent-skills", "--agent", "cursor", "-y", "-g"]);
    });
});

describe("installSkills", () => {
    let consoleLogSpy: MockInstance<typeof console.log>;
    let consoleErrorSpy: MockInstance<typeof console.error>;

    beforeEach(() => {
        spawnMock.mockReset();
        consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
        consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    });

    afterEach(() => {
        consoleLogSpy.mockRestore();
        consoleErrorSpy.mockRestore();
    });

    it("invokes npx skills@1 with -g and the supplied agent id", async () => {
        spawnMock.mockReturnValue(fakeChildProcess(0));

        await installSkills({ agentId: "cursor", cwd: "/workdir" });

        expect(spawnMock).toHaveBeenCalledTimes(1);
        const [cmd, args, opts] = spawnMock.mock.calls[0]!;
        expect(cmd).toBe("npx");
        expect(args).toEqual(["--yes", "skills@1", "add", "mongodb/agent-skills", "--agent", "cursor", "-y", "-g"]);
        expect(opts).toMatchObject({ stdio: "inherit", cwd: "/workdir" });
    });

    it("returns installed when the CLI exits 0", async () => {
        spawnMock.mockReturnValue(fakeChildProcess(0));

        const result = await installSkills({ agentId: "cursor", cwd: "/tmp" });

        expect(result).toEqual({ status: "installed" });
    });

    it("returns failed with exitCode when the CLI exits non-zero", async () => {
        spawnMock.mockReturnValue(fakeChildProcess(2));

        const result = await installSkills({ agentId: "cursor", cwd: "/tmp" });

        expect(result).toEqual({ status: "failed", exitCode: 2 });
    });

    it("prints a failure message including the exit code and a manual-fallback command", async () => {
        spawnMock.mockReturnValue(fakeChildProcess(7));

        await installSkills({ agentId: "cursor", cwd: "/tmp" });

        const printed = [...consoleLogSpy.mock.calls, ...consoleErrorSpy.mock.calls]
            .map((c: unknown[]) => String(c[0]))
            .join("\n");
        expect(printed).toContain("exit 7");
        // The retry command must mirror the real invocation — full npx command
        // including the pinned CLI and flags actually used.
        expect(printed).toContain("npx --yes skills@1 add mongodb/agent-skills --agent cursor -y -g");
        expect(printed).toContain("https://github.com/mongodb/agent-skills");
    });

    it("returns { status: 'failed' } when spawn emits an 'error' event (does not throw)", async () => {
        const emitter = new EventEmitter();
        setImmediate(() => emitter.emit("error", new Error("spawn ENOENT")));
        spawnMock.mockReturnValue(emitter as unknown as ChildProcess);

        // The whole point of this test: installSkills must not propagate the
        // error out of runSetup. Returning any "failed" outcome is enough.
        const result = await installSkills({ agentId: "cursor", cwd: "/tmp" });

        expect(result.status).toBe("failed");
    });

    it("treats a signal-killed subprocess (close fires with code=null) as failed, not installed", async () => {
        spawnMock.mockReturnValue(fakeChildProcessKilled("SIGTERM"));

        const result = await installSkills({ agentId: "cursor", cwd: "/tmp" });

        expect(result.status).toBe("failed");
        // Exit code should be the spawn-error sentinel, not 0.
        expect((result as { exitCode: number }).exitCode).not.toBe(0);
    });

    it("prints the signal name to stderr when the subprocess is killed by a signal", async () => {
        spawnMock.mockReturnValue(fakeChildProcessKilled("SIGKILL"));

        await installSkills({ agentId: "cursor", cwd: "/tmp" });

        const printed = consoleErrorSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("\n");
        expect(printed).toContain("SIGKILL");
    });
});

describe("promptAndInstallSkills", () => {
    let consoleLogSpy: MockInstance<typeof console.log>;

    beforeEach(() => {
        spawnMock.mockReset();
        confirmMock.mockReset();
        consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    });

    afterEach(() => {
        consoleLogSpy.mockRestore();
    });

    it("propagates ExitPromptError from inquirer so runSetup's Ctrl+C handler can run", async () => {
        // inquirer throws an Error with name='ExitPromptError' on Ctrl+C. That
        // must still escape promptAndInstallSkills so the outer runSetup catch
        // can print "Setup cancelled" and exit.
        const exitError = new Error("User force closed the prompt");
        exitError.name = "ExitPromptError";
        confirmMock.mockRejectedValue(exitError);

        await expect(promptAndInstallSkills({ tool: "cursor", cwd: "/tmp" })).rejects.toThrow(/force closed/);
    });

    it("skips prompts for Claude Desktop and returns no-agent-id", async () => {
        const result = await promptAndInstallSkills({ tool: "claudeDesktop", cwd: "/tmp" });

        expect(result).toEqual({ status: "skipped", reason: "no-agent-id" });
        expect(confirmMock).not.toHaveBeenCalled();
        expect(spawnMock).not.toHaveBeenCalled();
    });

    it("returns user-declined when the user says no to the Y/n prompt", async () => {
        confirmMock.mockResolvedValue(false);

        const result = await promptAndInstallSkills({ tool: "cursor", cwd: "/tmp" });

        expect(result).toEqual({ status: "skipped", reason: "user-declined" });
        expect(spawnMock).not.toHaveBeenCalled();
    });

    it("installs after Y/n=yes — no scope prompt", async () => {
        spawnMock.mockReturnValue(fakeChildProcess(0));
        confirmMock.mockResolvedValue(true);

        const result = await promptAndInstallSkills({ tool: "cursor", cwd: "/some/project/dir" });

        expect(result).toEqual({ status: "installed" });
        const [, args, opts] = spawnMock.mock.calls[0]!;
        // Always global now — no project/user prompt.
        expect(args).toContain("-g");
        expect(opts).toMatchObject({ cwd: "/some/project/dir" });
    });
});
