/* eslint-disable no-console */
import fs from "fs";
import path from "path";
import os from "os";
import { applyEdits, findNodeAtLocation, modify, parseTree } from "jsonc-parser";
import { exec } from "child_process";
import type { Platform } from "./setupAiToolsUtils.js";
import { formatError, getPlatform } from "./setupAiToolsUtils.js";

export type AIToolType = "cursor" | "vscode" | "windsurf" | "claudeDesktop" | "claudeCode" | "opencode";

// These are tools that don't have a designated editor to open the config file
export const TOOLS_WITHOUT_EDITORS: AIToolType[] = ["claudeDesktop", "claudeCode", "opencode"];

// Mac: open path in default app, or in editor (e.g. "cursor") if supported
const getOpenCommandMac = (configPath: string, tool: AIToolType): string =>
    tool && !TOOLS_WITHOUT_EDITORS.includes(tool) ? `open "${tool}://file${configPath}"` : `open "${configPath}"`;

// Linux: open path in default app, or in editor if supported
const getOpenCommandLinux = (configPath: string, tool: AIToolType): string =>
    tool && !TOOLS_WITHOUT_EDITORS.includes(tool)
        ? `xdg-open "${tool}://file${configPath}"`
        : `xdg-open "${configPath}"`;

// Windows: open path in default app (for tools without a dedicated editor)
const getOpenCommandWindowsDefault = (configPath: string): string => `start "" "${configPath}"`;

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

const getBasePath = (useDefaultPath?: boolean): string => {
    const platform: Platform | null = getPlatform();
    const isWindows = platform === "windows";
    // Sometimes in Windows we want to use the user home directory instead of APPDATA
    if (isWindows && !useDefaultPath) {
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
    abstract name: string; // readable name for the tool for users
    abstract toolType: AIToolType; // used internallly
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

    // Returns the shell command to open the config file. Override in subclasses for editor-specific behavior.
    getOpenConfigCommand(configPath: string, platform: Platform, editor: AIToolType): string | null {
        switch (platform) {
            case "mac":
                return getOpenCommandMac(configPath, editor);
            case "windows":
                return getOpenCommandWindowsDefault(configPath);
            case "linux":
                return getOpenCommandLinux(configPath, editor);
            default:
                return null;
        }
    }

    async openConfigSettings(): Promise<void> {
        const platform = getPlatform();
        if (!platform) {
            return;
        }
        const cmd = this.getOpenConfigCommand(this.configPath, platform, this.toolType);
        if (cmd) {
            await new Promise((resolve, reject) => {
                exec(cmd, (error) => {
                    if (error) {
                        reject(error);
                    } else {
                        resolve(undefined);
                    }
                });
            });
        }
    }
}

class Cursor extends AITool {
    name = "Cursor";
    toolType = "cursor" as AIToolType;
    configFileName = "mcp.json";
    get configPath(): string {
        return path.join(getBasePath(true), ".cursor", "mcp.json");
    }
    tip = `Tip: Press ${getPlatform() === "mac" ? "Cmd+I" : "Ctrl+I"} in Cursor to open the Agent panel.\n`;

    override getOpenConfigCommand(configPath: string, platform: Platform): string | null {
        switch (platform) {
            case "mac":
                return getOpenCommandMac(configPath, "cursor");
            case "windows":
                // TODO: fix in CLOUDP-385463
                return `cursor "${configPath}"`;
            case "linux":
                return getOpenCommandLinux(configPath, "cursor");
            default:
                return null;
        }
    }
}

class VSCode extends AITool {
    name = "VS Code";
    toolType = "vscode" as AIToolType;
    configFileName = "mcp.json";
    protected override getServersKey(): McpServers {
        return "servers";
    }
    get configPath(): string {
        const platform: Platform | null = getPlatform();
        switch (platform) {
            case "windows":
                return path.join(getBasePath(), "Code", "User", "mcp.json");
            case "mac":
                return path.join(getBasePath(), "Library", "Application Support", "Code", "User", "mcp.json");
            case "linux":
                return path.join(getBasePath(), ".config", "Code", "User", "mcp.json");
            default:
                return "";
        }
    }
    tip = `Tip: Press ${getPlatform() === "mac" ? "Cmd+Shift+I" : "Ctrl+Shift+I"} in VS Code to open the Copilot panel.\n`;

    override getOpenConfigCommand(configPath: string, platform: Platform): string | null {
        switch (platform) {
            case "mac":
                return getOpenCommandMac(configPath, "vscode");
            case "windows":
                // TODO: fix in CLOUDP-385463
                return `code "${configPath}"`;
            case "linux":
                return getOpenCommandLinux(configPath, "vscode");
            default:
                return null;
        }
    }
}

class Windsurf extends AITool {
    name = "Windsurf";
    toolType = "windsurf" as AIToolType;
    configFileName = "mcp_config.json";
    get configPath(): string {
        return path.join(getBasePath(true), ".codeium", "windsurf", "mcp_config.json");
    }
    tip = `Tip: Press ${getPlatform() === "mac" ? "Cmd+L" : "Ctrl+L"} in Windsurf to open the AI panel.\n`;
}

class ClaudeDesktop extends AITool {
    name = "Claude Desktop";
    toolType = "claudeDesktop" as AIToolType;
    configFileName = "claude_desktop_config.json";
    get configPath(): string {
        const platform: Platform | null = getPlatform();
        switch (platform) {
            case "windows":
                return path.join(getBasePath(), "Claude", "claude_desktop_config.json");
            case "mac":
                return path.join(
                    getBasePath(),
                    "Library",
                    "Application Support",
                    "Claude",
                    "claude_desktop_config.json"
                );
            case "linux":
                return path.join(getBasePath(), ".config", "Claude", "claude_desktop_config.json");
            default:
                return "";
        }
    }
}

class ClaudeCode extends AITool {
    name = "Claude Code";
    toolType = "claudeCode" as AIToolType;
    configFileName = ".claude.json";
    get configPath(): string {
        return path.join(getBasePath(true), ".claude.json");
    }
}

class OpenCode extends AITool {
    name = "Open Code";
    toolType = "opencode" as AIToolType;
    configFileName = "opencode.json";
    get configPath(): string {
        return path.join(getBasePath(true), ".config", "opencode", "opencode.json");
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

// Opens the config file for the given tool using the tool's platform-specific command.
export const openConfigSettings = (tool: AIToolType): Promise<void> => {
    return AI_TOOL_REGISTRY[tool].openConfigSettings();
};

export const AI_TOOL_REGISTRY: Record<AIToolType, AITool> = {
    ["cursor"]: new Cursor(),
    ["vscode"]: new VSCode(),
    ["windsurf"]: new Windsurf(),
    ["claudeDesktop"]: new ClaudeDesktop(),
    ["claudeCode"]: new ClaudeCode(),
    ["opencode"]: new OpenCode(),
};
