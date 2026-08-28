import fs, { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { canonicalPath } from "../shared.js";
import type { AgentHarnessConfig, AgentHarnessOptions } from "../types.js";

/** Fallback model when neither the real config nor an override is available. */
export const DEFAULT_CODEX_MODEL = "gpt-5.6-luna";

/** Reasoning effort applied to the harness session's model. */
export const DEFAULT_CODEX_REASONING_EFFORT = "low";

function tomlString(value: string): string {
    // TOML basic strings: escape backslash + double quote. URLs and paths on
    // mac/linux don't contain control chars.
    return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * {@link AgentHarnessConfig} for codex (OpenAI CLI agent).
 *
 * Encapsulates everything about how codex is configured for a hermetic e2e
 * session: the `$CODEX_HOME/config.toml` content (MCP server, pre-trusted
 * workdir, grove model provider, disabled plugins), the model catalog copy
 * next to it, and secret redaction for log dumps. See the module header for
 * the rationale behind each section of the generated config.
 */
export class CodexHarnessConfig implements AgentHarnessConfig {
    readonly homeDirEnvVar = "CODEX_HOME";
    readonly configFileName = "config.toml";

    /** Directory codex uses for its config/auth/caches (`CODEX_HOME` or ~/.codex). */
    getHostHomeDir(): string {
        return process.env[this.homeDirEnvVar] ?? path.join(os.homedir(), ".codex");
    }

    /** Path to the user's real codex config (outside the hermetic session). */
    getHostConfigPath(): string {
        return path.join(this.getHostHomeDir(), this.configFileName);
    }

    /**
     * Redact bearer tokens in a generated config so it can be printed safely
     * (e.g. for `debug` dumps in test logs).
     */
    redactSecrets(toml: string): string {
        return toml.replace(/(experimental_bearer_token\s*=\s*")[^"]*(")/g, "$1<redacted>$2");
    }

    /**
     * A top-level scalar from the user's real config (e.g. `model`,
     * `model_reasoning_effort`), or undefined when the config is absent/unreadable.
     */
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
     * Absolute path of a model catalog file to copy into the hermetic home: the
     * real config's `model_catalog_json` when set, falling back to codex's cached
     * models list (`~/.codex/models_cache.json`). Undefined when neither exists —
     * codex then resolves model metadata from its bundled/default catalog.
     */
    resolveHostModelCatalogPath(): string | undefined {
        const raw = this.getHostTopLevelValue("model_catalog_json");
        if (raw) {
            const expanded = raw.startsWith("~") ? path.join(os.homedir(), raw.slice(1)) : raw;
            return path.resolve(expanded);
        }
        const cached = path.join(this.getHostHomeDir(), "models_cache.json");
        return existsSync(cached) ? cached : undefined;
    }

    /**
     * TOML for the `grove` model provider (OpenAI-compatible gateway). The API
     * key is read from the `GROVE_API_KEY` environment variable via `env_key`,
     * and the same variable feeds the `api-key` request header
     * (`env_http_headers`). No secret is stored in the generated config.
     */
    private buildProviderToml(): string {
        return [
            `[model_providers.grove]`,
            `name = "Grove"`,
            `base_url = "https://grove-gateway-prod.azure-api.net/grove-foundry-prod/openai/v1"`,
            `env_key = "GROVE_API_KEY"`,
            `env_key_instructions = "Set GROVE_API_KEY in your environment"`,
            `supports_websockets = false`,
            `env_http_headers = { "api-key" = "GROVE_API_KEY" }`,
        ].join("\n");
    }

    /**
     * Copy the real config's model catalog, lifting the active model's per-model
     * `truncation_policy` limit. The cached catalog (e.g. codex's
     * `models_cache.json`) carries such a policy — gpt-5.6-luna is limited to 10k
     * tokens. At ~19k tokens for the 27 MCP tool definitions, codex truncates the
     * model request and the tools never reach the model. When copying the catalog
     * into the hermetic home, lift the truncation limit for the active model so
     * the test's tool set is fully visible (the limit is a machine-specific
     * artifact of the provider setup, not something the test needs).
     */
    private copyCatalogWithLiftedTruncation(source: string, dest: string, activeModel: string): void {
        const catalog = JSON.parse(fs.readFileSync(source, "utf8")) as {
            models?: { slug?: string; truncation_policy?: { mode?: string; limit?: number } | null }[];
        };
        let patched = false;
        for (const model of catalog.models ?? []) {
            if (model.slug !== activeModel) {
                continue;
            }
            if (model.truncation_policy && typeof model.truncation_policy.limit === "number") {
                model.truncation_policy.limit = 4_000_000; // well above any context window: effectively disabled
                patched = true;
            }
        }
        if (patched) {
            fs.writeFileSync(dest, JSON.stringify(catalog));
        } else {
            fs.copyFileSync(source, dest);
        }
    }

    private buildMcpServerToml(options: AgentHarnessOptions, mcpServerName: string): string {
        // Codex's default MCP startup timeout is 10s; the MongoDB server (with
        // full tool registration) can take a beat longer, and a hard timeout
        // leaves the session with no MCP server at all. Raise it generously.
        const startupTimeout = "startup_timeout_sec = 60";
        if (options.stdioServer) {
            const { command, args, env } = options.stdioServer;
            const envLines = Object.entries(env).map(([k, v]) => `${k} = ${tomlString(v)}`);
            return [
                `[mcp_servers.${mcpServerName}]`,
                `command = ${tomlString(command)}`,
                `args = [${args.map((a) => tomlString(a)).join(", ")}]`,
                startupTimeout,
                ...(envLines.length ? [``, `[mcp_servers.${mcpServerName}.env]`, ...envLines] : []),
            ].join("\n");
        }
        return `[mcp_servers.${mcpServerName}]\nurl = ${tomlString(options.serverUrl ?? "")}\n${startupTimeout}`;
    }

    buildConfig(options: AgentHarnessOptions, sessionHomeDir: string): string {
        const { mcpServerName = "mongo", model, workDir } = options;

        // Model priority: explicit `options.model` (CI override) > the model codex
        // already uses on this machine > fallback constant.
        const resolvedModel = model ?? this.getHostTopLevelValue("model") ?? DEFAULT_CODEX_MODEL;

        // Copy the model catalog into the hermetic home so codex can resolve the
        // model's metadata (context window etc.); without it the turn dies
        // immediately with "Model metadata ... not found".
        const catalogLines: string[] = [];
        const catalogSource = this.resolveHostModelCatalogPath();
        if (catalogSource && existsSync(catalogSource)) {
            const catalogDest = path.join(sessionHomeDir, "model-catalog.json");
            this.copyCatalogWithLiftedTruncation(catalogSource, catalogDest, resolvedModel);
            catalogLines.push(`model_catalog_json = ${tomlString(catalogDest)}`);
        }

        const lines = [
            "# Minimal hermetic codex config for the MongoDB MCP server agent e2e test.",
            `model = ${tomlString(resolvedModel)}`,
            `model_provider = "grove"`,
            `model_reasoning_effort = ${tomlString(DEFAULT_CODEX_REASONING_EFFORT)}`,
            ...catalogLines,
            "",
            this.buildProviderToml(),
            "",
            this.buildMcpServerToml(options, mcpServerName),
            "",
            // Pre-trust the test workdir (canonical path, see canonicalPath) so no
            // directory-trust prompt is shown.
            `[projects.${tomlString(canonicalPath(workDir))}]`,
            'trust_level = "trusted"',
            // See header comment: prevent the codex_apps connector stall.
            "",
            '[plugins."plugin-management@openai-curated-remote"]',
            "enabled = false",
            "",
        ];
        return lines.join("\n");
    }
}
