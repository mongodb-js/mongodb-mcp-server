/* eslint-disable no-console */
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import chalk from "chalk";
import { confirm } from "@inquirer/prompts";
import select from "@inquirer/select";
import { AI_TOOL_REGISTRY, type AIToolType } from "./aiTool.js";
import { parseBoolean } from "../common/config/configUtils.js";

export type SkillsInstallOutcome =
    | { status: "installed" }
    | { status: "skipped"; reason: "no-agent-id" | "user-declined" | "env-skip" }
    | { status: "failed"; exitCode: number };

export interface InstallSkillsOptions {
    tool: AIToolType;
    cwd: string;
    global?: boolean;
}

export interface PromptAndInstallSkillsOptions {
    tool: AIToolType;
    cwd: string;
}

const SKILLS_REPO = "mongodb/agent-skills";
const SKILLS_REPO_URL = `https://github.com/${SKILLS_REPO}`;
export const CLAUDE_DESKTOP_MESSAGE =
    `Claude Desktop doesn't have a filesystem-based skills directory — that's\n` +
    `an editor-agent feature. Your MongoDB MCP server is configured either\n` +
    `way, which works in Claude Desktop.\n` +
    `\n` +
    `To also get the MongoDB skill guidance in Claude Desktop, create a Claude\n` +
    `Project and paste each skill's SKILL.md content into the Project's custom\n` +
    `instructions. Skills live at:\n` +
    `\n` +
    `  ${SKILLS_REPO_URL}`;

const SKIP_ENV_VAR = "MDB_MCP_SKIP_SKILLS_INSTALL";
const SKILLS_PACKAGE_VERSION = "1";
const SKILLS_CLI_PIN = `skills@${SKILLS_PACKAGE_VERSION}`;

/** Assemble the args for `npx` to invoke the pinned skills CLI. */
export function buildSkillsAddArgs(agentId: string, global: boolean): string[] {
    const args = ["--yes", SKILLS_CLI_PIN, "add", SKILLS_REPO, "--agent", agentId, "-y"];
    if (global) {
        args.push("-g");
    }
    return args;
}

export type ProjectRootKind = "git" | "package" | "none";

export interface ProjectRootResolution {
    root: string;
    kind: ProjectRootKind;
}

/**
 * Walk up from `start` looking for a project root. Prefers `.git/`; falls
 * back to `package.json`; if neither exists, returns `start` itself with
 * kind `"none"`.
 */
export function resolveProjectRoot(start: string): ProjectRootResolution {
    const absoluteStart = path.resolve(start);
    const gitRoot = findUp(absoluteStart, (dir) => fs.existsSync(path.join(dir, ".git")));
    if (gitRoot) {
        return { root: gitRoot, kind: "git" };
    }
    const pkgRoot = findUp(absoluteStart, (dir) => fs.existsSync(path.join(dir, "package.json")));
    if (pkgRoot) {
        return { root: pkgRoot, kind: "package" };
    }
    return { root: absoluteStart, kind: "none" };
}

function findUp(start: string, predicate: (dir: string) => boolean): string | null {
    let dir = start;
    while (true) {
        if (predicate(dir)) {
            return dir;
        }
        const parent = path.dirname(dir);
        if (parent === dir) {
            return null;
        }
        dir = parent;
    }
}

/**
 * Shell out to `skills add` for the given tool. Non-zero exit is reported to
 * the user but does not throw — setup has already succeeded by this point.
 */
export async function installSkills(opts: InstallSkillsOptions): Promise<SkillsInstallOutcome> {
    const agentId = AI_TOOL_REGISTRY[opts.tool].getSkillsAgentId();
    if (agentId === null) {
        console.log(CLAUDE_DESKTOP_MESSAGE);
        return { status: "skipped", reason: "no-agent-id" };
    }

    const args = buildSkillsAddArgs(agentId, opts.global ?? false);
    const exitCode = await runSkillsAdd(args, opts.cwd);

    if (exitCode === 0) {
        return { status: "installed" };
    }

    printInstallFailure(exitCode, agentId);
    return { status: "failed", exitCode };
}

function runSkillsAdd(args: string[], cwd: string): Promise<number> {
    return new Promise<number>((resolve, reject) => {
        const child = spawn("npx", args, { stdio: "inherit", cwd });
        child.on("close", (code) => resolve(code ?? 0));
        child.on("error", (err) => reject(err));
    });
}

function printInstallFailure(exitCode: number, agentId: string): void {
    console.log("");
    console.log(
        chalk.red(
            `Agent skills install failed (exit ${exitCode}). Setup completed, but skills were not installed. See the CLI output above for details.`
        )
    );
    console.log("");
    console.log("You can retry manually:");
    console.log(`  npx skills add ${SKILLS_REPO} --agent ${agentId}`);
    console.log("");
    console.log(`Skills repo: ${SKILLS_REPO_URL}`);
    console.log("");
}

/**
 * Prompt the user for whether to install skills, choose a scope, and call
 * `installSkills`. Honors `MDB_MCP_SKIP_SKILLS_INSTALL` as a non-interactive
 * off switch. Null-agent tools (Claude Desktop) skip prompts entirely.
 */
export async function promptAndInstallSkills(opts: PromptAndInstallSkillsOptions): Promise<SkillsInstallOutcome> {
    if (parseBoolean(process.env[SKIP_ENV_VAR]) === true) {
        return { status: "skipped", reason: "env-skip" };
    }

    const tool = AI_TOOL_REGISTRY[opts.tool];
    if (tool.getSkillsAgentId() === null) {
        console.log(CLAUDE_DESKTOP_MESSAGE);
        return { status: "skipped", reason: "no-agent-id" };
    }

    const shouldInstall = await confirm({
        message: `Install the MongoDB Agent Skills for ${tool.name}?`,
        default: true,
    });
    if (!shouldInstall) {
        return { status: "skipped", reason: "user-declined" };
    }

    const projectRoot = resolveProjectRoot(opts.cwd);

    const scope = await select<"project" | "user">({
        message: "Install scope?",
        default: "project",
        choices: [
            { value: "project", name: `Project (${projectRoot.root}/)` },
            { value: "user", name: "User (global)" },
        ],
    });

    return installSkills({
        tool: opts.tool,
        cwd: scope === "project" ? projectRoot.root : opts.cwd,
        global: scope === "user",
    });
}
