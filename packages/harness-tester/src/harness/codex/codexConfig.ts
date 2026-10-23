import { execFileSync } from "node:child_process";
import fs, { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { canonicalPath, oauthCredentialStoreKey } from "../shared.js";
import type { AgentHarnessConfig, AgentHarnessOptions } from "../types.js";

/**
 * Fallback model when neither the real config nor an override is available.
 * Keep this on the latest model codex ships, so codex does not show its
 * "Try new model" onboarding dialog (which blocks the composer) on first run.
 */
export const DEFAULT_CODEX_MODEL = "gpt-6-luna";

/** Reasoning effort applied to the harness session's model. */
export const DEFAULT_CODEX_REASONING_EFFORT = "low";

/**
 * Abort a model response stream after this long without a chunk, then retry.
 * Codex's default is 5 minutes, which outlives a test's turn budget.
 */
export const STREAM_IDLE_TIMEOUT_MS = 30_000;

function tomlString(value: string): string {
    // TOML basic strings: escape backslash + double quote.
    return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** {@link AgentHarnessConfig} for codex (OpenAI CLI agent). */
export class CodexHarnessConfig implements AgentHarnessConfig {
    readonly homeDirEnvVar = "CODEX_HOME";
    readonly configFileName = "config.toml";

    private readonly binaryPath: string;

    constructor({ binaryPath = process.env.AGENT_E2E_CODEX_BIN ?? "codex" }: { binaryPath?: string } = {}) {
        this.binaryPath = binaryPath;
    }

    /** Directory codex uses for its config/auth/caches (`CODEX_HOME` or ~/.codex). */
    getHostHomeDir(): string {
        return process.env[this.homeDirEnvVar] ?? path.join(os.homedir(), ".codex");
    }

    /** Path to the user's real codex config (outside the hermetic session). */
    getHostConfigPath(): string {
        return path.join(this.getHostHomeDir(), this.configFileName);
    }

    /** A top-level scalar from the user's real config (e.g. `model`), or undefined when absent. */
    getHostTopLevelValue(key: string): string | undefined {
        try {
            const text = fs.readFileSync(this.getHostConfigPath(), "utf8");
            const match = text.match(new RegExp(`^${key}\\s*=\\s*"?([^"\\#\\n]+)`, "m"));
            return match?.[1]?.trim();
        } catch {
            return undefined;
        }
    }

    /**
     * Model catalog to copy into the hermetic home: the real config's
     * `model_catalog_json`, else codex's cached models list; undefined when neither exists.
     */
    resolveHostModelCatalogPath(): string | undefined {
        const raw = this.getHostTopLevelValue("model_catalog_json");
        if (raw) {
            const expanded = raw.startsWith("~/") ? path.join(os.homedir(), raw.slice(1)) : raw;
            return path.resolve(expanded);
        }
        const cached = path.join(this.getHostHomeDir(), "models_cache.json");
        return existsSync(cached) ? cached : undefined;
    }

    /** Grove provider TOML: key read from `GROVE_API_KEY` via `env_key` — no secret in the config. */
    private buildProviderToml(): string {
        return [
            `[model_providers.grove]`,
            `name = "Grove"`,
            `base_url = "https://grove-gateway-prod.azure-api.net/grove-foundry-prod/openai/v1"`,
            `env_key = "GROVE_API_KEY"`,
            `env_key_instructions = "Set GROVE_API_KEY in your environment"`,
            `supports_websockets = false`,
            `env_http_headers = { "api-key" = "GROVE_API_KEY" }`,
            // The default 5-minute idle timeout is longer than a test's turn budget, so a
            // stalled response stream (seen behind CI's proxy) looks like a hang. Abort and
            // retry much sooner so a transient stall recovers within the harness timeout.
            `stream_idle_timeout_ms = ${STREAM_IDLE_TIMEOUT_MS}`,
        ].join("\n");
    }

    /**
     * Copy the real config's model catalog, lifting the active model's
     * `truncation_policy` limit (codex would otherwise truncate the tool
     * definitions from the model request).
     */
    private copyCatalogWithLiftedTruncation({
        source,
        dest,
        activeModel,
    }: {
        source: string;
        dest: string;
        activeModel: string;
    }): void {
        const catalog = JSON.parse(fs.readFileSync(source, "utf8")) as {
            models?: { slug?: string; truncation_policy?: { mode?: string; limit?: number } | null }[];
        };
        let patched = false;
        for (const model of catalog.models ?? []) {
            if (model.slug !== activeModel) {
                continue;
            }
            if (model.truncation_policy && typeof model.truncation_policy.limit === "number") {
                model.truncation_policy.limit = 4_000_000; // effectively disabled
                patched = true;
            }
        }
        if (patched) {
            fs.writeFileSync(dest, JSON.stringify(catalog));
        } else {
            fs.copyFileSync(source, dest);
        }
    }

    /**
     * Top-level scalars; must precede every table header (otherwise TOML absorbs them into the
     * following `[mcp_servers.X.env]`/`.http_headers` table and codex rejects a non-string env value).
     */
    private buildSandboxTopLevelToml(): string {
        return ['sandbox_mode = "read-only"', "allow_login_shell = false"].join("\n");
    }

    /** Whitelist the session to MCP tools only: disable shell + web-search. */
    private buildSandboxToml(): string {
        return ["[features]", "shell_tool = false", "", "[tools]", "web_search = false"].join("\n");
    }

    private buildMcpServerToml(options: AgentHarnessOptions, mcpServerName: string): string {
        // Codex's 10s default MCP startup timeout is too short for this server.
        const startupTimeout = "startup_timeout_sec = 60";
        // Auto-approve MCP tool calls: codex otherwise interposes a blocking
        // tool-approval prompt the harness cannot answer. The server's own
        // elicitation (confirmation-required tools) is still surfaced.
        const toolsApprovalMode = 'default_tools_approval_mode = "approve"';
        // Wait for the tool catalog before accepting a prompt: otherwise codex
        // shows an idle composer while the MCP servers boot, and a prompt sent
        // in that window runs without the server's tools.
        const startupReadiness = 'startup_readiness = "catalog"';
        if (options.stdioServer) {
            const { command, args, env } = options.stdioServer;
            const envLines = Object.entries(env).map(([k, v]) => `${k} = ${tomlString(v)}`);
            return [
                `[mcp_servers.${mcpServerName}]`,
                `command = ${tomlString(command)}`,
                `args = [${args.map((a) => tomlString(a)).join(", ")}]`,
                startupTimeout,
                toolsApprovalMode,
                startupReadiness,
                ...(envLines.length ? [``, `[mcp_servers.${mcpServerName}.env]`, ...envLines] : []),
            ].join("\n");
        }
        const lines = [
            `[mcp_servers.${mcpServerName}]`,
            `url = ${tomlString(options.serverUrl ?? "")}`,
            startupTimeout,
            toolsApprovalMode,
            startupReadiness,
        ];
        const headerLines = Object.entries(options.headers ?? {}).map(
            ([k, v]) => `${tomlString(k)} = ${tomlString(v)}`
        );
        if (headerLines.length > 0) {
            lines.push("", `[mcp_servers.${mcpServerName}.http_headers]`, ...headerLines);
        }
        return lines.join("\n");
    }

    /**
     * Render codex's built-in model catalog (`codex debug models`) into the
     * session home. Used on machines without a cached catalog (CI): without a
     * catalog codex applies its built-in 10k-token tool truncation, which drops
     * the server's larger tool definitions.
     */
    private renderBuiltinCatalog(sessionHomeDir: string): string | undefined {
        const dest = path.join(sessionHomeDir, "builtin-model-catalog.json");
        try {
            const json = execFileSync(this.binaryPath, ["debug", "models"], {
                env: { ...process.env, CODEX_HOME: sessionHomeDir },
                encoding: "utf8",
                timeout: 30_000,
                stdio: ["ignore", "pipe", "ignore"],
            });
            JSON.parse(json);
            fs.writeFileSync(dest, json);
            return dest;
        } catch {
            return undefined;
        }
    }

    /**
     * Catalog to copy into the hermetic home with the active model's truncation
     * limit lifted: the host's catalog when it lists the active model, else
     * codex's built-in one. The host cache can be stale and lack newer models,
     * in which case codex falls back to its 10k-token tool truncation.
     */
    private resolveModelCatalogPath(sessionHomeDir: string, activeModel: string): string | undefined {
        const hostCatalog = this.resolveHostModelCatalogPath();
        const hostHasModel =
            hostCatalog !== undefined && existsSync(hostCatalog) && this.catalogHasModel(hostCatalog, activeModel);
        const source =
            (hostHasModel ? hostCatalog : undefined) ??
            this.renderBuiltinCatalog(sessionHomeDir) ??
            (hostCatalog !== undefined && existsSync(hostCatalog) ? hostCatalog : undefined);
        if (!source) {
            return undefined;
        }
        const dest = path.join(sessionHomeDir, "model-catalog.json");
        this.copyCatalogWithLiftedTruncation({ source, dest, activeModel });
        return dest;
    }

    /** Whether a model catalog file lists the given model slug. */
    private catalogHasModel(catalogPath: string, model: string): boolean {
        try {
            const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8")) as { models?: { slug?: string }[] };
            return (catalog.models ?? []).some((entry) => entry.slug === model);
        } catch {
            return false;
        }
    }

    buildConfig(options: AgentHarnessOptions, sessionHomeDir: string): string {
        const { mcpServerName = "mongo", model, workDir } = options;

        // Model: `options.model` > the model codex already uses > fallback.
        const resolvedModel = model ?? this.getHostTopLevelValue("model") ?? DEFAULT_CODEX_MODEL;

        // Copy the model catalog so codex can resolve model metadata and does not
        // truncate the server's tool definitions from the model request.
        const catalogLines: string[] = [];
        const catalogSource = this.resolveModelCatalogPath(sessionHomeDir, resolvedModel);
        if (catalogSource) {
            catalogLines.push(`model_catalog_json = ${tomlString(catalogSource)}`);
        }

        const lines = [
            "# Minimal hermetic codex config for the MongoDB MCP server agent e2e test.",
            `model = ${tomlString(resolvedModel)}`,
            `model_provider = "grove"`,
            `model_reasoning_effort = ${tomlString(DEFAULT_CODEX_REASONING_EFFORT)}`,
            // Keep pre-seeded OAuth tokens in the hermetic home instead of the OS keyring.
            ...(options.oauth ? [`mcp_oauth_credentials_store = "file"`] : []),
            ...catalogLines,
            "",
            // Top-level scalars must precede the table headers below.
            this.buildSandboxTopLevelToml(),
            "",
            this.buildProviderToml(),
            "",
            this.buildMcpServerToml(options, mcpServerName),
            "",
            this.buildSandboxToml(),
            "",
            // Pre-trust the test workdir (canonical path) so no trust prompt is shown.
            `[projects.${tomlString(canonicalPath(workDir))}]`,
            'trust_level = "trusted"',
            // Disable codex_apps (plugin-management connector), which would stall the session.
            "",
            '[plugins."plugin-management@openai-curated-remote"]',
            "enabled = false",
            "",
        ];
        return lines.join("\n");
    }
}

/** Read and parse a JSON file, or an empty map when missing/unreadable. */
function readJsonFile(filePath: string): Record<string, unknown> {
    try {
        return JSON.parse(fs.readFileSync(filePath, "utf8")) as Record<string, unknown>;
    } catch {
        return {};
    }
}

/**
 * Pre-seed OAuth tokens in the session's `.credentials.json` so codex connects
 * to a remote server without an interactive login. Requires
 * `mcp_oauth_credentials_store = "file"` (set by `buildConfig` when `oauth` is
 * present); codex matches entries by `server_name` + `server_url`, so the map
 * key is informational. No-op unless `options.oauth` is set.
 */
export function seedCodexOAuthCredentials({
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
    const key = oauthCredentialStoreKey({
        serverName,
        serverUrl: options.serverUrl,
        headers: options.headers,
    });
    const store = readJsonFile(path.join(homeDir, ".credentials.json"));
    store[key] = {
        server_name: serverName,
        server_url: options.serverUrl,
        ...(oauth.issuer !== undefined ? { issuer: oauth.issuer } : {}),
        client_id: oauth.clientId ?? "",
        ...(oauth.clientSecret !== undefined ? { client_secret: oauth.clientSecret } : {}),
        access_token: oauth.accessToken,
        ...(oauth.expiresAt !== undefined ? { expires_at: oauth.expiresAt } : {}),
        ...(oauth.refreshToken !== undefined ? { refresh_token: oauth.refreshToken } : {}),
        scopes: oauth.scopes ?? [],
    };
    fs.writeFileSync(path.join(homeDir, ".credentials.json"), JSON.stringify(store, null, 2), { mode: 0o600 });
}
