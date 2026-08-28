import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { canonicalPath } from "../shared.js";
import type { AgentHarnessConfig, AgentHarnessOptions } from "../types.js";

/** Default model: grove serves the undated id; `haiku` resolves to a dated id it lacks. */
export const DEFAULT_CLAUDE_MODEL = "claude-haiku-4-5";

/** Grove gateway Anthropic endpoint (no trailing /v1; claude appends it). */
export const GROVE_ANTHROPIC_BASE_URL = "https://grove-gateway-prod.azure-api.net/grove-foundry-prod/anthropic";

/**
 * Environment variables the harness sets on the spawned claude process.
 * Secret values (the grove key) are read from `GROVE_API_KEY` at spawn time
 * so the generated config files never contain them.
 */
export function buildClaudeEnv(options: AgentHarnessOptions): Record<string, string> {
    const groveApiKey = process.env.GROVE_API_KEY ?? "";
    // Model priority: explicit `options.model` (CI override) > env override > default.
    const model = options.model ?? process.env.AGENT_E2E_CLAUDE_MODEL ?? DEFAULT_CLAUDE_MODEL;
    return {
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
        ANTHROPIC_BASE_URL: GROVE_ANTHROPIC_BASE_URL,
        ANTHROPIC_AUTH_TOKEN: groveApiKey,
        ANTHROPIC_CUSTOM_HEADERS: `api-key: ${groveApiKey}`,
        ANTHROPIC_MODEL: model,
    };
}

/**
 * {@link AgentHarnessConfig} for claude (Anthropic Claude Code CLI).
 *
 * Claude has no single config file to generate for this setup; `buildConfig`
 * returns the `--mcp-config` JSON document registering the MongoDB MCP
 * server, written to `mcp-config.json` inside the session home.
 */
export class ClaudeHarnessConfig implements AgentHarnessConfig {
    readonly homeDirEnvVar = "CLAUDE_CONFIG_DIR";
    readonly configFileName = "mcp-config.json";

    /** Directory claude uses for its config/state on the host machine. */
    getHostHomeDir(): string {
        return process.env[this.homeDirEnvVar] ?? path.join(os.homedir(), ".claude");
    }

    buildConfig(options: AgentHarnessOptions): string {
        const mcpServerName = options.mcpServerName ?? "mongo";
        const server = options.stdioServer
            ? {
                  type: "stdio",
                  command: options.stdioServer.command,
                  args: options.stdioServer.args,
                  env: options.stdioServer.env,
              }
            : { type: "http", url: options.serverUrl ?? "" };
        return JSON.stringify({ mcpServers: { [mcpServerName]: server } }, null, 2);
    }

    /**
     * The generated config holds no secrets (the API key is passed through the
     * process environment), so redaction is the identity.
     */
    redactSecrets(config: string): string {
        return config;
    }
}

/**
 * Pre-seed the hermetic claude home with the state that suppresses onboarding
 * and trust dialogs (see the module header). Mutates nothing outside the home.
 *
 * @param mcpServerName the MCP server name registered in mcp-config.json; the
 *        settings whitelist is scoped to its tools (`mcp__<name>__*`).
 */
export function seedClaudeHome(homeDir: string, workDir: string, mcpServerName = "mongo"): void {
    const canonical = canonicalPath(workDir);
    const claudeJson = {
        hasCompletedOnboarding: true,
        shiftEnterKeyBindingInstalled: true,
        theme: "dark",
        // `noMCP`-style project entry: mark the test workdir trusted so the
        // "Is this a project you created or one you trust?" gate never shows.
        projects: {
            [canonical]: { hasTrustDialogAccepted: true, allowedTools: [] },
        },
    };
    // Whitelist the session to MCP tools only: `dontAsk` mode never prompts
    // and auto-denies anything not pre-approved, so the allow list below is
    // the whole toolset — no bash, no file tools, no web. Assumes the session
    // runs without a `--permission-mode` CLI override (see claudeTui.ts).
    const settingsJson = {
        permissions: {
            defaultMode: "dontAsk",
            allow: [`mcp__${mcpServerName}__*`],
        },
        skipDangerousModePermissionPrompt: true,
    };
    fs.writeFileSync(path.join(homeDir, ".claude.json"), JSON.stringify(claudeJson, null, 2));
    fs.writeFileSync(path.join(homeDir, "settings.json"), JSON.stringify(settingsJson, null, 2));
}
