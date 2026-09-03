import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { canonicalPath } from "../shared.js";
import type { AgentHarnessConfig, AgentHarnessOptions } from "../types.js";

/** Default model: grove serves the undated id; `haiku` resolves to a dated id it lacks. */
export const DEFAULT_CLAUDE_MODEL = "claude-haiku-4-5";

/** Grove gateway Anthropic endpoint (no trailing /v1; claude appends it). */
export const GROVE_ANTHROPIC_BASE_URL = "https://grove-gateway-prod.azure-api.net/grove-foundry-prod/anthropic";

/** Env for the spawned claude process; the grove key is read live from `GROVE_API_KEY`, never written to config files. */
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

/** {@link AgentHarnessConfig} for claude: emits the `--mcp-config` JSON registering the MCP server. */
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
}

/**
 * Pre-seed the hermetic claude home to suppress onboarding/trust dialogs.
 * Mutates nothing outside the home.
 *
 * @param mcpServerName MCP server name; the allow list is scoped to its tools (`mcp__<name>__*`).
 */
export function seedClaudeHome(homeDir: string, workDir: string, mcpServerName = "mongo"): void {
    const canonical = canonicalPath(workDir);
    const claudeJson = {
        hasCompletedOnboarding: true,
        shiftEnterKeyBindingInstalled: true,
        theme: "dark",
        // Mark the test workdir trusted so the trust gate never shows.
        projects: {
            [canonical]: { hasTrustDialogAccepted: true, allowedTools: [] },
        },
    };
    // `dontAsk` auto-denies anything not in `allow`, so this list is the whole
    // toolset (MCP tools only — no bash/file/web tools).
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
