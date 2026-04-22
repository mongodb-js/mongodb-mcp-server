import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest";
import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

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
    resolveProjectRoot,
    CLAUDE_DESKTOP_MESSAGE,
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
    setImmediate(() => emitter.emit("close", exitCode));
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

describe("resolveProjectRoot", () => {
    let tmpRoot: string;

    beforeEach(() => {
        tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mdb-skills-test-"));
    });

    afterEach(() => {
        fs.rmSync(tmpRoot, { recursive: true, force: true });
    });

    it("returns kind='git' when .git is found at or above cwd", () => {
        const repoRoot = path.join(tmpRoot, "repo");
        const nested = path.join(repoRoot, "src", "nested");
        fs.mkdirSync(nested, { recursive: true });
        fs.mkdirSync(path.join(repoRoot, ".git"));

        const result = resolveProjectRoot(nested);

        expect(result.kind).toBe("git");
        expect(result.root).toBe(repoRoot);
    });

    it("returns kind='package' when package.json is found but no .git", () => {
        const pkgRoot = path.join(tmpRoot, "pkg");
        const nested = path.join(pkgRoot, "src");
        fs.mkdirSync(nested, { recursive: true });
        fs.writeFileSync(path.join(pkgRoot, "package.json"), "{}");

        const result = resolveProjectRoot(nested);

        expect(result.kind).toBe("package");
        expect(result.root).toBe(pkgRoot);
    });

    it("prefers .git over package.json when both are present", () => {
        const repoRoot = path.join(tmpRoot, "repo");
        const pkgRoot = path.join(repoRoot, "pkg");
        const nested = path.join(pkgRoot, "src");
        fs.mkdirSync(nested, { recursive: true });
        fs.mkdirSync(path.join(repoRoot, ".git"));
        fs.writeFileSync(path.join(pkgRoot, "package.json"), "{}");

        const result = resolveProjectRoot(nested);

        expect(result.kind).toBe("git");
        expect(result.root).toBe(repoRoot);
    });

    it("returns kind='none' with cwd as root when no project markers exist", () => {
        // tmpRoot itself has no .git, no package.json, and (on this test runner)
        // no ancestors with them up to the OS tmpdir.
        // Subtle: the machine running this test likely has a package.json in $HOME
        // or above, so we use a sub-dir of os.tmpdir() which shouldn't.
        const bare = path.join(tmpRoot, "bare");
        fs.mkdirSync(bare);

        const result = resolveProjectRoot(bare);

        expect(result.kind).toBe("none");
        expect(result.root).toBe(bare);
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

    it("prints the canonical Claude Desktop message when skipping", async () => {
        await installSkills({ tool: "claudeDesktop", cwd: "/tmp" });
        const printed = consoleLogSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("\n");
        expect(printed).toContain(CLAUDE_DESKTOP_MESSAGE);
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
        expect(printed).toContain("npx skills add mongodb/agent-skills --agent cursor");
        expect(printed).toContain("https://github.com/mongodb/agent-skills");
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

    it("throws when MDB_MCP_SKIP_SKILLS_INSTALL has an invalid value", async () => {
        process.env.MDB_MCP_SKIP_SKILLS_INSTALL = "yes"; // parseBoolean rejects this

        await expect(promptAndInstallSkills({ tool: "cursor", cwd: "/tmp" })).rejects.toThrow(/Invalid boolean/);
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

    it("asks for scope after Y/n=yes and passes global=false when scope='project'", async () => {
        spawnMock.mockReturnValue(fakeChildProcess(0));
        confirmMock.mockResolvedValue(true);
        selectMock.mockResolvedValue("project" as unknown as never);

        const result = await promptAndInstallSkills({ tool: "cursor", cwd: "/tmp" });

        expect(result).toEqual({ status: "installed" });
        expect(selectMock).toHaveBeenCalled();
        const [, args] = spawnMock.mock.calls[0]!;
        expect(args).not.toContain("-g");
    });

    it("passes global=true when scope='user'", async () => {
        spawnMock.mockReturnValue(fakeChildProcess(0));
        confirmMock.mockResolvedValue(true);
        selectMock.mockResolvedValue("user" as unknown as never);

        await promptAndInstallSkills({ tool: "cursor", cwd: "/tmp" });

        const [, args] = spawnMock.mock.calls[0]!;
        expect(args).toContain("-g");
    });

    it("defaults scope to 'project' even when no project markers exist", async () => {
        // Create a scratch dir with no .git and no package.json ancestors.
        const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "mdb-skills-scope-"));
        try {
            spawnMock.mockReturnValue(fakeChildProcess(0));
            confirmMock.mockResolvedValue(true);
            selectMock.mockResolvedValue("project" as unknown as never);

            await promptAndInstallSkills({ tool: "cursor", cwd: scratch });

            expect(selectMock).toHaveBeenCalledTimes(1);
            const config = selectMock.mock.calls[0]![0] as { default?: string };
            expect(config.default).toBe("project");
        } finally {
            fs.rmSync(scratch, { recursive: true, force: true });
        }
    });

    it("includes the resolved project root path in the 'Project' choice label", async () => {
        const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "mdb-skills-label-"));
        try {
            spawnMock.mockReturnValue(fakeChildProcess(0));
            confirmMock.mockResolvedValue(true);
            selectMock.mockResolvedValue("project" as unknown as never);

            await promptAndInstallSkills({ tool: "cursor", cwd: scratch });

            const config = selectMock.mock.calls[0]![0] as {
                choices: ReadonlyArray<{ value: string; name: string }>;
            };
            const projectChoice = config.choices.find((c) => c.value === "project");
            expect(projectChoice).toBeDefined();
            expect(projectChoice!.name).toContain(scratch);
        } finally {
            fs.rmSync(scratch, { recursive: true, force: true });
        }
    });

    it("installs at cwd (not at a global dir) when no project markers exist", async () => {
        const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "mdb-skills-cwd-"));
        try {
            spawnMock.mockReturnValue(fakeChildProcess(0));
            confirmMock.mockResolvedValue(true);
            selectMock.mockResolvedValue("project" as unknown as never);

            await promptAndInstallSkills({ tool: "cursor", cwd: scratch });

            const [, args, opts] = spawnMock.mock.calls[0]!;
            expect(args).not.toContain("-g");
            expect(opts).toMatchObject({ cwd: scratch });
        } finally {
            fs.rmSync(scratch, { recursive: true, force: true });
        }
    });
});
