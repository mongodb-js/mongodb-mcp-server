import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest";
import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";

vi.mock("node:child_process", () => ({
    spawn: vi.fn(),
}));

vi.mock("@inquirer/prompts", () => ({
    confirm: vi.fn(),
}));

vi.mock("@inquirer/select", () => ({
    default: vi.fn(),
}));

import { spawn } from "node:child_process";
import { confirm } from "@inquirer/prompts";
import select from "@inquirer/select";
import {
    buildSkillsAddArgs,
    installSkills,
    promptAndInstallSkills,
    NO_SKILLS_MESSAGE,
} from "../../../src/setup/installSkills.js";

const spawnMock = vi.mocked(spawn);
const confirmMock = vi.mocked(confirm);
const selectMock = vi.mocked(select);

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
    it("assembles args for project-scope install (no -g)", () => {
        const args = buildSkillsAddArgs("cursor", false);
        expect(args).toEqual(["--yes", "skills@1", "add", "mongodb/agent-skills", "--agent", "cursor", "-y"]);
    });

    it("assembles args for user-scope install (adds -g)", () => {
        const args = buildSkillsAddArgs("claude-code", true);
        expect(args).toEqual([
            "--yes",
            "skills@1",
            "add",
            "mongodb/agent-skills",
            "--agent",
            "claude-code",
            "-y",
            "-g",
        ]);
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

    it("short-circuits with 'no-agent-id' for Claude Desktop and does not spawn", async () => {
        const result = await installSkills({ tool: "claudeDesktop", cwd: "/tmp" });

        expect(result).toEqual({ status: "skipped", reason: "no-agent-id" });
        expect(spawnMock).not.toHaveBeenCalled();
    });

    it("prints the no-skills-support message when the tool has no agent ID", async () => {
        await installSkills({ tool: "claudeDesktop", cwd: "/tmp" });
        const printed = consoleLogSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("\n");
        expect(printed).toContain(NO_SKILLS_MESSAGE);
    });

    it("invokes npx skills@1 with project-scope args when global is false", async () => {
        spawnMock.mockReturnValue(fakeChildProcess(0));

        await installSkills({ tool: "cursor", cwd: "/workdir", global: false });

        expect(spawnMock).toHaveBeenCalledTimes(1);
        const [cmd, args, opts] = spawnMock.mock.calls[0]!;
        expect(cmd).toBe("npx");
        expect(args).toEqual(["--yes", "skills@1", "add", "mongodb/agent-skills", "--agent", "cursor", "-y"]);
        expect(opts).toMatchObject({ stdio: "inherit", cwd: "/workdir" });
    });

    it("invokes npx skills@1 with -g when global is true", async () => {
        spawnMock.mockReturnValue(fakeChildProcess(0));

        await installSkills({ tool: "claudeCode", cwd: "/workdir", global: true });

        const [, args] = spawnMock.mock.calls[0]!;
        expect(args).toContain("-g");
        expect(args).toContain("claude-code");
    });

    it("returns { status: 'installed' } when the CLI exits 0", async () => {
        spawnMock.mockReturnValue(fakeChildProcess(0));

        const result = await installSkills({ tool: "cursor", cwd: "/tmp" });

        expect(result).toEqual({ status: "installed" });
    });

    it("returns { status: 'failed', exitCode } when the CLI exits non-zero", async () => {
        spawnMock.mockReturnValue(fakeChildProcess(2));

        const result = await installSkills({ tool: "cursor", cwd: "/tmp" });

        expect(result).toEqual({ status: "failed", exitCode: 2 });
    });

    it("prints a failure message including the exit code and a manual-fallback command", async () => {
        spawnMock.mockReturnValue(fakeChildProcess(7));

        await installSkills({ tool: "cursor", cwd: "/tmp" });

        const printed = [...consoleLogSpy.mock.calls, ...consoleErrorSpy.mock.calls]
            .map((c: unknown[]) => String(c[0]))
            .join("\n");
        expect(printed).toContain("exit 7");
        // The retry command must mirror the real invocation — full npx command
        // including the pinned CLI and flags actually used.
        expect(printed).toContain("npx --yes skills@1 add mongodb/agent-skills --agent cursor -y");
        expect(printed).toContain("https://github.com/mongodb/agent-skills");
    });

    it("retry command in failure message preserves -g when scope was user (global=true)", async () => {
        spawnMock.mockReturnValue(fakeChildProcess(3));

        await installSkills({ tool: "cursor", cwd: "/tmp", global: true });

        const printed = [...consoleLogSpy.mock.calls, ...consoleErrorSpy.mock.calls]
            .map((c: unknown[]) => String(c[0]))
            .join("\n");
        // Full user-scope retry command, including -g at the end.
        expect(printed).toContain("npx --yes skills@1 add mongodb/agent-skills --agent cursor -y -g");
    });

    it("returns { status: 'failed' } when spawn emits an 'error' event (does not throw)", async () => {
        const emitter = new EventEmitter();
        setImmediate(() => emitter.emit("error", new Error("spawn ENOENT")));
        spawnMock.mockReturnValue(emitter as unknown as ChildProcess);

        // The whole point of this test: installSkills must not propagate the
        // error out of runSetup. Returning any "failed" outcome is enough.
        const result = await installSkills({ tool: "cursor", cwd: "/tmp" });

        expect(result.status).toBe("failed");
    });

    it("treats a signal-killed subprocess (close fires with code=null) as failed, not installed", async () => {
        spawnMock.mockReturnValue(fakeChildProcessKilled("SIGTERM"));

        const result = await installSkills({ tool: "cursor", cwd: "/tmp" });

        expect(result.status).toBe("failed");
        // Exit code should be the spawn-error sentinel, not 0.
        expect((result as { exitCode: number }).exitCode).not.toBe(0);
    });

    it("prints the signal name to stderr when the subprocess is killed by a signal", async () => {
        spawnMock.mockReturnValue(fakeChildProcessKilled("SIGKILL"));

        await installSkills({ tool: "cursor", cwd: "/tmp" });

        const printed = consoleErrorSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("\n");
        expect(printed).toContain("SIGKILL");
    });
});

describe("promptAndInstallSkills", () => {
    const originalEnv = { ...process.env };
    let consoleLogSpy: MockInstance<typeof console.log>;

    beforeEach(() => {
        spawnMock.mockReset();
        confirmMock.mockReset();
        selectMock.mockReset();
        delete process.env.MDB_MCP_SKIP_SKILLS_INSTALL;
        consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    });

    afterEach(() => {
        process.env = { ...originalEnv };
        consoleLogSpy.mockRestore();
    });

    it("returns env-skip when MDB_MCP_SKIP_SKILLS_INSTALL is 'true'", async () => {
        process.env.MDB_MCP_SKIP_SKILLS_INSTALL = "true";

        const result = await promptAndInstallSkills({ tool: "cursor", cwd: "/tmp" });

        expect(result).toEqual({ status: "skipped", reason: "env-skip" });
        expect(confirmMock).not.toHaveBeenCalled();
        expect(spawnMock).not.toHaveBeenCalled();
    });

    it("proceeds when MDB_MCP_SKIP_SKILLS_INSTALL is 'false'", async () => {
        process.env.MDB_MCP_SKIP_SKILLS_INSTALL = "false";
        confirmMock.mockResolvedValue(false); // decline to keep the test short

        const result = await promptAndInstallSkills({ tool: "cursor", cwd: "/tmp" });

        expect(confirmMock).toHaveBeenCalled();
        expect(result).toEqual({ status: "skipped", reason: "user-declined" });
    });

    it("returns failed (not throws) when MDB_MCP_SKIP_SKILLS_INSTALL has an invalid value, and prints a warning", async () => {
        process.env.MDB_MCP_SKIP_SKILLS_INSTALL = "yes"; // parseBoolean rejects this
        const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
        try {
            const result = await promptAndInstallSkills({ tool: "cursor", cwd: "/tmp" });

            // Must not throw — setup has already written MCP config, so a bad
            // env var here should degrade to a failed outcome, not kill setup.
            expect(result.status).toBe("failed");
            const warnings = consoleWarnSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("\n");
            expect(warnings).toMatch(/invalid boolean/i);
        } finally {
            consoleWarnSpy.mockRestore();
        }
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
        expect(selectMock).not.toHaveBeenCalled();
        expect(spawnMock).not.toHaveBeenCalled();
    });

    it("returns user-declined when the user says no to the Y/n prompt", async () => {
        confirmMock.mockResolvedValue(false);

        const result = await promptAndInstallSkills({ tool: "cursor", cwd: "/tmp" });

        expect(result).toEqual({ status: "skipped", reason: "user-declined" });
        expect(selectMock).not.toHaveBeenCalled();
        expect(spawnMock).not.toHaveBeenCalled();
    });

    it("asks for scope after Y/n=yes and installs at opts.cwd (no -g) when scope='project'", async () => {
        spawnMock.mockReturnValue(fakeChildProcess(0));
        confirmMock.mockResolvedValue(true);
        selectMock.mockResolvedValue("project" as unknown as never);

        const result = await promptAndInstallSkills({ tool: "cursor", cwd: "/some/project/dir" });

        expect(result).toEqual({ status: "installed" });
        expect(selectMock).toHaveBeenCalled();
        const [, args, opts] = spawnMock.mock.calls[0]!;
        expect(args).not.toContain("-g");
        expect(opts).toMatchObject({ cwd: "/some/project/dir" });
    });

    it("passes global=true when scope='user'", async () => {
        spawnMock.mockReturnValue(fakeChildProcess(0));
        confirmMock.mockResolvedValue(true);
        selectMock.mockResolvedValue("user" as unknown as never);

        await promptAndInstallSkills({ tool: "cursor", cwd: "/tmp" });

        const [, args] = spawnMock.mock.calls[0]!;
        expect(args).toContain("-g");
    });

    it("always defaults scope to 'project'", async () => {
        spawnMock.mockReturnValue(fakeChildProcess(0));
        confirmMock.mockResolvedValue(true);
        selectMock.mockResolvedValue("project" as unknown as never);

        await promptAndInstallSkills({ tool: "cursor", cwd: "/some/dir" });

        expect(selectMock).toHaveBeenCalledTimes(1);
        const config = selectMock.mock.calls[0]![0] as { default?: string };
        expect(config.default).toBe("project");
    });

    it("includes opts.cwd in the 'Project' choice label", async () => {
        spawnMock.mockReturnValue(fakeChildProcess(0));
        confirmMock.mockResolvedValue(true);
        selectMock.mockResolvedValue("project" as unknown as never);

        await promptAndInstallSkills({ tool: "cursor", cwd: "/some/unique/path" });

        const config = selectMock.mock.calls[0]![0] as {
            choices: ReadonlyArray<{ value: string; name: string }>;
        };
        const projectChoice = config.choices.find((c) => c.value === "project");
        expect(projectChoice).toBeDefined();
        expect(projectChoice!.name).toContain("/some/unique/path");
    });

    it("passes opts.cwd as the spawn cwd when scope='user' (even with -g)", async () => {
        spawnMock.mockReturnValue(fakeChildProcess(0));
        confirmMock.mockResolvedValue(true);
        selectMock.mockResolvedValue("user" as unknown as never);

        await promptAndInstallSkills({ tool: "cursor", cwd: "/some/caller/dir" });

        const [, args, opts] = spawnMock.mock.calls[0]!;
        expect(args).toContain("-g");
        expect(opts).toMatchObject({ cwd: "/some/caller/dir" });
    });
});
