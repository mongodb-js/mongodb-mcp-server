/* eslint-disable no-console */
import fs from "fs";
import path from "path";
import os from "os";
import { applyEdits, findNodeAtLocation, modify, parseTree } from "jsonc-parser";
import type { Platform } from "./setupAiToolsUtils.js";
import { formatError, getPlatform } from "./setupAiToolsUtils.js";

export type AIToolType = "cursor" | "vscode" | "windsurf" | "claudeDesktop" | "claudeCode" | "opencode";

// These are tools that don't have a designated editor to open the config file
export const TOOLS_WITHOUT_EDITORS: AIToolType[] = ["claudeDesktop", "claudeCode", "opencode"];

const MCP_SERVER_KEY = "mongodb-mcp-server";
type EnvironmentKey = "env" | "environment";
type McpConfigEntry = {
    command: string;
    args: string[];
    env?: Record<string, string>;
};
type OpenCodeMcpEntry = {
    type: "local";
    command: string[];
    environment?: Record<string, string>;
    enabled?: boolean;
};
type McpConfig =
    | { mcpServers: Record<string, McpConfigEntry> }
    | { servers: Record<string, McpConfigEntry> }
    | { mcp: Record<string, OpenCodeMcpEntry> };

type McpServers = "mcpServers" | "servers" | "mcp";

const getBasePath = (): string => {
    const platform: Platform | null = getPlatform();
    const isWindows = platform === "windows";

    if (isWindows) {
        return process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
    } else {
        return os.homedir();
    }
};

// Gets an existing servers: {}, mcpServers: {}, or mcp: {} object in the config file or create it if it doesn't exist
const getOrCreateServersEntry = (
    config: McpConfig,
    serversKey: McpServers
): Record<string, McpConfigEntry | OpenCodeMcpEntry> => {
    const mutable = config as Record<string, Record<string, McpConfigEntry | OpenCodeMcpEntry>>;
    if (!mutable[serversKey]) {
        mutable[serversKey] = {};
    }
    // Cast so callers can assign OpenCodeMcpEntry when serversKey is "mcp" (avoids TS narrowing)
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
    return mutable[serversKey] as Record<string, McpConfigEntry | OpenCodeMcpEntry>;
};

// Ensures the directory for the config file exists
const ensureConfigDir = (configPath: string): void => {
    const resolvedPath = path.resolve(configPath);
    const configDir = path.dirname(resolvedPath);
    if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
    }
};

const writeConfigFile = (configPath: string, config: McpConfig): void => {
    const resolvedPath = path.resolve(configPath);
    ensureConfigDir(configPath);
    try {
        fs.writeFileSync(resolvedPath, JSON.stringify(config, null, 2), "utf-8");
    } catch (err: unknown) {
        throw new Error(
            `Could not write config to ${resolvedPath}: ${formatError(err)}. ` +
                "Check that the path is correct and you have permission to write to that location."
        );
    }
    if (!fs.existsSync(resolvedPath)) {
        throw new Error(`Config file was not created at ${resolvedPath}.`);
    }
};

// Normalized shape for in-place patches (works for both McpConfigEntry and OpenCodeMcpEntry)
type ConfigEntryPatch = {
    command: string | string[];
    args?: string[];
    envKey: EnvironmentKey;
    envRecord: Record<string, string>;
    enabled?: boolean; // Used for Open Code only
    type?: "local"; // Used for Open Code only
};

function toPatch(entry: McpConfigEntry | OpenCodeMcpEntry, envKey: EnvironmentKey): ConfigEntryPatch {
    const envRecord: Record<string, string> =
        "env" in entry ? (entry.env ?? {}) : "environment" in entry ? (entry.environment ?? {}) : {};
    const patch: ConfigEntryPatch = {
        command: entry.command,
        args: "args" in entry ? entry.args : undefined,
        envKey,
        envRecord,
    };
    if ("type" in entry) {
        patch.type = entry.type;
    }
    if ("enabled" in entry) {
        patch.enabled = entry.enabled;
    }
    return patch;
}

// Updates existing config content in place using jsonc-parser; preserves comments and spacing.
const updateConfigInPlace = (
    existingContent: string,
    serversKey: McpServers,
    patch: ConfigEntryPatch,
    entry: McpConfigEntry | OpenCodeMcpEntry
): string => {
    const parsedContent = parseTree(existingContent);
    const basePath: [string, string] = [serversKey, MCP_SERVER_KEY];
    const contentBlock = parsedContent ? findNodeAtLocation(parsedContent, basePath) : undefined;
    const opts = { formattingOptions: { tabSize: 2, insertSpaces: true, eol: "\n" } };

    if (contentBlock) {
        let text = existingContent;
        text = applyEdits(text, modify(text, [...basePath, "command"], patch.command, opts));
        if (patch.args !== undefined) {
            text = applyEdits(text, modify(text, [...basePath, "args"], patch.args, opts));
        }
        for (const [k, v] of Object.entries(patch.envRecord)) {
            text = applyEdits(text, modify(text, [...basePath, patch.envKey, k], v, opts));
        }
        if (patch.enabled !== undefined) {
            text = applyEdits(text, modify(text, [...basePath, "enabled"], patch.enabled, opts));
        }
        if (patch.type !== undefined) {
            text = applyEdits(text, modify(text, [...basePath, "type"], patch.type, opts));
        }
        return text;
    }

    return applyEdits(existingContent, modify(existingContent, basePath, entry, opts));
};

export abstract class AITool {
    abstract name: string;
    abstract configFileName: string;
    abstract get configPath(): string;
    tip?: string;

    // Default key is mcpServers, but we will use this function to override in subclasses (e.g. VS Code uses "servers").
    protected getServersKey(): McpServers {
        return "mcpServers";
    }

    protected getEnvironmentKey(): "env" | "environment" {
        return "env";
    }

    protected readConfig(configPath: string): McpConfig {
        const serversKey = this.getServersKey();
        const emptyConfig = (): McpConfig => ({ [serversKey]: {} }) as McpConfig;
        let config: McpConfig = emptyConfig();
        if (fs.existsSync(configPath)) {
            try {
                const existingContent = fs.readFileSync(configPath, "utf-8");
                config = JSON.parse(existingContent) as McpConfig;
                getOrCreateServersEntry(config, serversKey);
            } catch (e: unknown) {
                console.error(
                    `Warning: Could not parse existing ${this.configFileName}, creating new config. Error is: ${formatError(e)}`
                );
                config = emptyConfig();
            }
        }
        return config;
    }

    protected buildMcpConfigEntry(isReadOnly: boolean, env: Record<string, string>): McpConfigEntry | OpenCodeMcpEntry {
        const args = ["-y", "mongodb-mcp-server@latest"];
        if (isReadOnly) {
            args.push("--readOnly");
        }
        return {
            command: "npx",
            args: ["-y", "mongodb-mcp-server@latest"],
            env,
        };
    }

    updateConfig(configPath: string, env: Record<string, string>, isReadOnly: boolean): void {
        const serversKey = this.getServersKey();
        const environmentKey = this.getEnvironmentKey();
        const updatedMcpConfigEntry = this.buildMcpConfigEntry(isReadOnly, env);

        const existingContent = fs.existsSync(configPath) ? fs.readFileSync(configPath, "utf-8") : null;
        if (existingContent !== null && existingContent.trim().length > 0) {
            const resolvedPath = path.resolve(configPath);
            ensureConfigDir(configPath);
            try {
                // Patch in place if file already has content
                const patch = toPatch(updatedMcpConfigEntry, environmentKey);
                const newContent = updateConfigInPlace(existingContent, serversKey, patch, updatedMcpConfigEntry);
                fs.writeFileSync(resolvedPath, newContent, "utf-8");
            } catch {
                // Fallback: write full config if in-place update fails (e.g. invalid JSONC)
                const config = this.readConfig(configPath);
                const servers = getOrCreateServersEntry(config, serversKey);
                servers[MCP_SERVER_KEY] = updatedMcpConfigEntry;
                writeConfigFile(configPath, config);
            }
        } else {
            // New file: write full config
            const config = this.readConfig(configPath);
            const servers = getOrCreateServersEntry(config, serversKey);
            servers[MCP_SERVER_KEY] = updatedMcpConfigEntry;
            writeConfigFile(configPath, config);
        }
    }
}

class Cursor extends AITool {
    name = "Cursor";
    configFileName = "mcp.json";
    get configPath(): string {
        const platform: Platform | null = getPlatform();
        const isWindows = platform === "windows";
        const isMac = platform === "mac";
        const isLinux = platform === "linux";

        if (isWindows) {
            return path.join(getBasePath(), "Cursor", "mcp.json");
        }
        if (isMac || isLinux) {
            return path.join(getBasePath(), ".cursor", "mcp.json");
        }
        return "";
    }
    tip = `Tip: Press ${getPlatform() === "mac" ? "Cmd+I" : "Ctrl+I"} in Cursor to open the Agent panel.\n`;
}

class VSCode extends AITool {
    name = "VS Code";
    configFileName = "mcp.json";
    protected override getServersKey(): McpServers {
        return "servers";
    }
    get configPath(): string {
        const platform: Platform | null = getPlatform();
        const isWindows = platform === "windows";
        const isMac = platform === "mac";
        const isLinux = platform === "linux";

        if (isWindows) {
            return path.join(getBasePath(), "Code", "User", "mcp.json");
        }
        if (isMac) {
            return path.join(getBasePath(), "Library", "Application Support", "Code", "User", "mcp.json");
        }
        if (isLinux) {
            return path.join(getBasePath(), ".config", "Code", "User", "mcp.json");
        }
        return "";
    }
    tip = `Tip: Press ${getPlatform() === "mac" ? "Cmd+Shift+I" : "Ctrl+Shift+I"} in VS Code to open the Copilot panel.\n`;
}

class Windsurf extends AITool {
    name = "Windsurf";
    configFileName = "mcp_config.json";
    get configPath(): string {
        const platform: Platform | null = getPlatform();
        const isWindows = platform === "windows";
        const isMac = platform === "mac";
        const isLinux = platform === "linux";

        if (isWindows) {
            return path.join(getBasePath(), "cascade", "mcp_config.json");
        }
        if (isMac || isLinux) {
            return path.join(getBasePath(), ".config", "cascade", "mcp_config.json");
        }
        return "";
    }
    tip = `Tip: Press ${getPlatform() === "mac" ? "Cmd+L" : "Ctrl+L"} in Windsurf to open the AI panel.\n`;
}

class ClaudeDesktop extends AITool {
    name = "Claude Desktop";
    configFileName = "claude_desktop_config.json";
    get configPath(): string {
        const platform: Platform | null = getPlatform();
        const isWindows = platform === "windows";
        const isMac = platform === "mac";
        const isLinux = platform === "linux";

        if (isWindows) {
            return path.join(getBasePath(), "Claude", "claude_desktop_config.json");
        }
        if (isMac) {
            return path.join(getBasePath(), "Claude", "claude_desktop_config.json");
        }
        if (isLinux) {
            return path.join(getBasePath(), ".config", "Claude", "claude_desktop_config.json");
        }
        return "";
    }
}

class ClaudeCode extends AITool {
    name = "Claude Code";
    configFileName = ".claude.json";
    get configPath(): string {
        return path.join(getBasePath(), ".claude.json");
    }
}

class OpenCode extends AITool {
    name = "Open Code";
    configFileName = "opencode.json";
    get configPath(): string {
        return path.join(getBasePath(), ".config", "opencode", "opencode.json");
    }
    protected override getServersKey(): McpServers {
        return "mcp";
    }
    protected override getEnvironmentKey(): EnvironmentKey {
        return "environment";
    }
    override buildMcpConfigEntry(isReadOnly: boolean, env: Record<string, string>): OpenCodeMcpEntry {
        const args = ["-y", "mongodb-mcp-server@latest"];
        if (isReadOnly) {
            args.push("--readOnly");
        }
        return {
            type: "local",
            command: ["npx", ...args],
            environment: Object.keys(env).length > 0 ? env : undefined,
            enabled: true,
        };
    }
}

export const AI_TOOL_REGISTRY: Record<AIToolType, AITool> = {
    ["cursor"]: new Cursor(),
    ["vscode"]: new VSCode(),
    ["windsurf"]: new Windsurf(),
    ["claudeDesktop"]: new ClaudeDesktop(),
    ["claudeCode"]: new ClaudeCode(),
    ["opencode"]: new OpenCode(),
};
