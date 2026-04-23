/* eslint-disable no-console */
import { spawn } from "node:child_process";
import chalk from "chalk";
import { confirm } from "@inquirer/prompts";
import select from "@inquirer/select";
import { AI_TOOL_REGISTRY, type AIToolType } from "./aiTool.js";
import { parseBoolean } from "../common/config/configUtils.js";

export type SkillsScope = "project" | "user";

export type SkillsInstallOutcome =
    | { status: "installed"; scope: SkillsScope }
    | { status: "skipped"; reason: "no-agent-id" | "user-declined" | "env-skip" }
    // `scope` is optional on failed because the promptAndInstallSkills wrapper
    // can catch errors that happen before the scope prompt resolves.
    | { status: "failed"; exitCode: number; scope?: SkillsScope };

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
export const NO_SKILLS_MESSAGE =
    `We're unable to install the MongoDB Agent Skills for this tool.\n` +
    `\n` +
    `See the MongoDB Agent Skills repo for manual install instructions:\n` +
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

/**
 * Shell out to `skills add` for the given tool. Non-zero exit is reported to
 * the user but does not throw — setup has already succeeded by this point.
 */
export async function installSkills(opts: InstallSkillsOptions): Promise<SkillsInstallOutcome> {
    const agentId = AI_TOOL_REGISTRY[opts.tool].getSkillsAgentId();
    if (agentId === null) {
        console.log(NO_SKILLS_MESSAGE);
        return { status: "skipped", reason: "no-agent-id" };
    }

    const global = opts.global ?? false;
    const scope: SkillsScope = global ? "user" : "project";
    const args = buildSkillsAddArgs(agentId, global);
    const exitCode = await runSkillsAdd(args, opts.cwd);

    if (exitCode === 0) {
        return { status: "installed", scope };
    }

    printInstallFailure(exitCode, args);
    return { status: "failed", exitCode, scope };
}

// Sentinel exit code used when `spawn` itself fails before the process runs
// (e.g. `npx` not on PATH). Real exit codes are 0–255, so -1 is unambiguous.
const SPAWN_ERROR_EXIT_CODE = -1;

function runSkillsAdd(args: string[], cwd: string): Promise<number> {
    return new Promise<number>((resolve) => {
        // `shell: true` is required on Windows so `npx` (a `.cmd` shim) resolves
        // through PATHEXT. Our args are controlled and contain no shell
        // metacharacters, so there's no injection risk.
        const child = spawn("npx", args, { stdio: "inherit", cwd, shell: true });
        child.on("close", (code, signal) => {
            if (signal !== null) {
                // Killed by a signal (Ctrl+C, OOM, etc.). `code` is null in this
                // case, so falling through to `code ?? 0` would mis-report the
                // install as successful. Surface it as a non-zero sentinel.
                console.error(chalk.red(`The skills CLI was terminated by signal ${signal}.`));
                resolve(SPAWN_ERROR_EXIT_CODE);
                return;
            }
            resolve(code ?? 0);
        });
        child.on("error", (err) => {
            // Spawn-level error (npx missing, etc.). Print the message ourselves
            // — nothing streamed to stderr because the process never started —
            // then surface as a non-zero exit so the graceful-failure path runs.
            console.error(chalk.red(`Failed to spawn the skills CLI: ${err.message}`));
            resolve(SPAWN_ERROR_EXIT_CODE);
        });
    });
}

function printInstallFailure(exitCode: number, args: string[]): void {
    console.log("");
    console.log(
        chalk.red(
            `Agent skills install failed (exit ${exitCode}). Setup completed, but skills were not installed. See the CLI output above for details.`
        )
    );
    console.log("");
    console.log("You can retry manually:");
    console.log(`  npx ${args.join(" ")}`);
    console.log("");
    console.log(`Skills repo: ${SKILLS_REPO_URL}`);
    console.log("");
}

/**
 * Prompt the user for whether to install skills, choose a scope, and call
 * `installSkills`. Honors `MDB_MCP_SKIP_SKILLS_INSTALL` as a non-interactive
 * off switch. Null-agent tools (Claude Desktop) skip prompts entirely.
 *
 * Never throws — except `ExitPromptError`, which is re-thrown so `runSetup`'s
 * outer Ctrl+C handler can print "Setup cancelled". All other errors
 * (invalid skip-env-var value, unexpected prompt failure, etc.) are logged
 * as warnings and converted to a `failed` outcome so setup can still print
 * its success summary.
 */
export async function promptAndInstallSkills(opts: PromptAndInstallSkillsOptions): Promise<SkillsInstallOutcome> {
    try {
        if (parseBoolean(process.env[SKIP_ENV_VAR]) === true) {
            return { status: "skipped", reason: "env-skip" };
        }

        const tool = AI_TOOL_REGISTRY[opts.tool];
        if (tool.getSkillsAgentId() === null) {
            console.log(NO_SKILLS_MESSAGE);
            return { status: "skipped", reason: "no-agent-id" };
        }

        const shouldInstall = await confirm({
            message: `Install the MongoDB Agent Skills for ${tool.name}?`,
            default: true,
        });
        if (!shouldInstall) {
            return { status: "skipped", reason: "user-declined" };
        }

        const scope = await select<"project" | "user">({
            message: "Install scope?",
            default: "project",
            choices: [
                { value: "project", name: `Project (${opts.cwd}/)` },
                { value: "user", name: "User (global)" },
            ],
        });

        return await installSkills({
            tool: opts.tool,
            cwd: opts.cwd,
            global: scope === "user",
        });
    } catch (error: unknown) {
        // Ctrl+C: inquirer throws ExitPromptError. Let it propagate so the
        // top-level runSetup handler can exit cleanly.
        if (error && typeof error === "object" && "name" in error && error.name === "ExitPromptError") {
            throw error;
        }
        const message = error instanceof Error ? error.message : String(error);
        console.warn(chalk.yellow(`\nWarning: skills install step failed: ${message}`));
        return { status: "failed", exitCode: SPAWN_ERROR_EXIT_CODE };
    }
}
