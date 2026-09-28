import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { canonicalPath, oauthCredentialStoreKey } from "../shared.js";
import type { AgentHarnessConfig, AgentHarnessOptions } from "../types.js";

/** Default model: grove serves the undated id; `haiku` resolves to a dated id it lacks. */
export const DEFAULT_CLAUDE_MODEL = "claude-haiku-4-5";

/** Minimum reasoning effort for e2e runs (mirrors the codex harness's `"low"`). */
export const DEFAULT_CLAUDE_EFFORT_LEVEL = "low";

/** Grove gateway Anthropic endpoint (no trailing /v1; claude appends it). */
export const GROVE_ANTHROPIC_BASE_URL = "https://grove-gateway-prod.azure-api.net/grove-foundry-prod/anthropic";

export function resolveClaudeModel(options: AgentHarnessOptions): string {
    // Model priority: explicit `options.model` (CI override) > env override > default.

    return options.model || process.env.AGENT_E2E_CLAUDE_MODEL || DEFAULT_CLAUDE_MODEL;
}

/** Env for the spawned claude process; the grove key is read live from `GROVE_API_KEY`, never written to config files. */
export function buildClaudeEnv(options: AgentHarnessOptions): Record<string, string> {
    const groveApiKey = process.env.GROVE_API_KEY ?? "";
    return {
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
        // Keep e2e runs cheap and deterministic: no extended thinking plus minimum
        // reasoning effort (mirrors the codex harness's `model_reasoning_effort = "low"`).
        // On the Anthropic API MAX_THINKING_TOKENS=0 turns thinking off; against a
        // gateway (grove) it omits the `thinking` parameter instead. `--effort low` is
        // also passed on the command line for top precedence.
        MAX_THINKING_TOKENS: "0",
        CLAUDE_CODE_EFFORT_LEVEL: DEFAULT_CLAUDE_EFFORT_LEVEL,
        ANTHROPIC_BASE_URL: GROVE_ANTHROPIC_BASE_URL,
        ANTHROPIC_AUTH_TOKEN: groveApiKey,
        ANTHROPIC_CUSTOM_HEADERS: `api-key: ${groveApiKey}`,
        // `ANTHROPIC_MODEL` and `--model` are the only model slots that win over the
        // org default (Opus) even when the org sets override-user-selection; pin haiku.
        ANTHROPIC_MODEL: resolveClaudeModel(options),
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
            : {
                  type: "http",
                  url: options.serverUrl ?? "",
                  ...(options.headers && Object.keys(options.headers).length > 0 ? { headers: options.headers } : {}),
              };
        return JSON.stringify({ mcpServers: { [mcpServerName]: server } }, null, 2);
    }
}

/** Read and parse a JSON file, or `undefined` when missing/unreadable. */
function readJsonFile(filePath: string): Record<string, unknown> | undefined {
    try {
        return JSON.parse(fs.readFileSync(filePath, "utf8")) as Record<string, unknown>;
    } catch {
        return undefined;
    }
}

/**
 * Pre-seed `mcpOAuth` tokens in the session's `.credentials.json`, keyed by
 * {@link oauthCredentialStoreKey}, so claude connects to a remote server without
 * an interactive browser login. No-op unless `options.oauth` is set.
 *
 * Caveat: on macOS claude normally reads the `Claude Code-credentials` OS
 * keychain, which this file does not override; the file store is the fallback
 * (and what CI/Linux use).
 */
export function seedClaudeOAuthCredentials({
    homeDir,
    options,
}: {
    homeDir: string;
    options: AgentHarnessOptions;
}): void {
    if (!options.oauth || !options.serverUrl) {
        return;
    }
    const { oauth } = options;
    const serverName = options.mcpServerName ?? "mongo";
    const credentialsPath = path.join(homeDir, ".credentials.json");
    const existing = readJsonFile(credentialsPath) ?? {};
    const mcpOAuth = { ...((existing.mcpOAuth as Record<string, unknown> | undefined) ?? {}) };
    const key = oauthCredentialStoreKey({
        serverName,
        serverUrl: options.serverUrl,
        headers: options.headers,
    });
    mcpOAuth[key] = {
        serverName,
        serverUrl: options.serverUrl,
        accessToken: oauth.accessToken,
        ...(oauth.refreshToken !== undefined ? { refreshToken: oauth.refreshToken } : {}),
        ...(oauth.expiresAt !== undefined ? { expiresAt: oauth.expiresAt } : {}),
        ...(oauth.clientId !== undefined ? { clientId: oauth.clientId } : {}),
        ...(oauth.clientSecret !== undefined ? { clientSecret: oauth.clientSecret } : {}),
        ...(oauth.issuer !== undefined ? { issuer: oauth.issuer } : {}),
        // Only set the discovery URL from the actual issuer: the MCP resource URL is a
        // different host (e.g. mcp.mongodb.com vs cloud.mongodb.com), so falling back to
        // it would make Claude refresh against the wrong authorization server.
        ...(oauth.issuer !== undefined ? { discoveryState: { authorizationServerUrl: oauth.issuer } } : {}),
    };
    fs.writeFileSync(credentialsPath, JSON.stringify({ ...existing, mcpOAuth }, null, 2), { mode: 0o600 });
}

/**
 * Pre-seed the hermetic claude home to suppress onboarding/trust dialogs.
 * Mutates nothing outside the home.
 *
 * @param mcpServerName MCP server name; the allow list is scoped to its tools (`mcp__<name>__*`).
 */
export function seedClaudeHome({
    homeDir,
    workDir,
    mcpServerName = "mongo",
}: {
    homeDir: string;
    workDir: string;
    mcpServerName?: string;
}): void {
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
