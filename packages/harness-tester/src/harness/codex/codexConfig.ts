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
    // TOML basic strings: escape backslash + double quote.
    return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** {@link AgentHarnessConfig} for codex (OpenAI CLI agent). */
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
        ].join("\n");
    }

    /**
     * Copy the real config's model catalog, lifting the active model's
     * `truncation_policy` limit (codex would otherwise truncate the tool
     * definitions from the model request).
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
     * Whitelist the session to MCP tools only: disable shell + web-search and
     * pin the sandbox to read-only (the MCP HTTP call runs in the orchestrator,
     * outside the sandbox).
     */
    private buildSandboxToml(): string {
        return [
            'sandbox_mode = "read-only"',
            // Top-level scalars must precede the table headers below.
            "allow_login_shell = false",
            "",
            "[features]",
            "shell_tool = false",
            "",
            "[tools]",
            "web_search = false",
        ].join("\n");
    }

    private buildMcpServerToml(options: AgentHarnessOptions, mcpServerName: string): string {
        // Codex's 10s default MCP startup timeout is too short for this server.
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

        // Model: `options.model` > the model codex already uses > fallback.
        const resolvedModel = model ?? this.getHostTopLevelValue("model") ?? DEFAULT_CODEX_MODEL;

        // Copy the model catalog so codex can resolve model metadata (without it the turn dies early).
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
