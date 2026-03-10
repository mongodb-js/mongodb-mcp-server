/* eslint-disable no-console */
import fs from "fs";
import path from "path";
import os from "os";
import type { Platform } from "./setupAiToolsUtils.js";
import { formatError, getPlatform } from "./setupAiToolsUtils.js";

export type AIToolType = "cursor" | "vscode" | "windsurf" | "claudeDesktop" | "claudeCode" | "codex" | "opencode";

// These are tools that don't have a designated editor to open the config file
export const TOOLS_WITHOUT_EDITORS: AIToolType[] = ["claudeDesktop", "claudeCode", "codex", "opencode"];

export interface McpConfigEntry {
    command: string;
    args: string[];
    env: Record<string, string>;
}

export type McpConfig =
    | { mcpServers: Record<string, McpConfigEntry> }
    | { servers: Record<string, McpConfigEntry> }
    | { mcp: Record<string, McpConfigEntry> };

type McpServers = "mcpServers" | "servers" | "mcp";

interface OpenCodeMcpEntry {
    type: "local";
    command: string[];
    environment?: Record<string, string>;
    enabled?: boolean;
}

interface OpenCodeConfig {
    mcp?: Record<string, OpenCodeMcpEntry>;
    [key: string]: unknown;
}

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
const getOrCreateServersEntry = (config: McpConfig, serversKey: McpServers): Record<string, McpConfigEntry> => {
    const mutable = config as Record<string, Record<string, McpConfigEntry>>;
    if (!mutable[serversKey]) {
        mutable[serversKey] = {};
    }
    return mutable[serversKey];
};

// Builds the rest of the MCP config entry
const buildMcpConfigEntry = (isReadOnly: boolean, env: Record<string, string>): McpConfigEntry => {
    const args = ["-y", "mongodb-mcp-server@latest"];
    if (isReadOnly) {
        args.push("--readOnly");
    }
    return {
        command: "npx",
        args,
        env,
    };
};

const writeConfigFile = (configPath: string, config: McpConfig): void => {
    const resolvedPath = path.resolve(configPath);
    const configDir = path.dirname(resolvedPath);
    try {
        if (!fs.existsSync(configDir)) {
            fs.mkdirSync(configDir, { recursive: true });
        }
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

export abstract class AITool {
    abstract name: string;
    abstract configFileName: string;
    abstract get configPath(): string;
    tip?: string;

    // Default key is mcpServers, but we will use this function to override in subclasses (e.g. VS Code uses "servers").
    protected getServersKey(): McpServers {
        return "mcpServers";
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

    updateConfig(configPath: string, env: Record<string, string>, isReadOnly: boolean): void {
        const config = this.readConfig(configPath);
        const serversKey = this.getServersKey();
        const servers = getOrCreateServersEntry(config, serversKey);
        servers["mongodb-mcp-server"] = buildMcpConfigEntry(isReadOnly, env);
        writeConfigFile(configPath, config);
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

class Codex extends AITool {
    name = "OpenAI Codex";
    configFileName = "config.toml";
    get configPath(): string {
        return path.join(getBasePath(), ".codex", "config.toml");
    }

    // The config file for codex is in TOML format, so the the values for each field is in-line
    override updateConfig(configPath: string, env: Record<string, string>, isReadOnly: boolean): void {
        const args = ["-y", "mongodb-mcp-server@latest"];
        if (isReadOnly) {
            args.push("--readOnly");
        }
        const envEntry =
            Object.keys(env).length > 0
                ? `\nenv = { ${Object.entries(env)
                      .map(([k, v]) => `${JSON.stringify(k)} = ${JSON.stringify(v)}`)
                      .join(", ")} }`
                : "";
        const section = `[mcp_servers.mongodb-mcp-server]
command = "npx"
args = ${JSON.stringify(args)}${envEntry}`;

        let existing = "";
        if (fs.existsSync(configPath)) {
            existing = fs.readFileSync(configPath, "utf-8");
            if (existing.includes("[mcp_servers.mongodb-mcp-server]")) {
                // TODO: this cannot return, we'd need to modify with new fields
                return;
            }
            if (!existing.endsWith("\n")) {
                existing += "\n";
            }
        } else {
            const configDir = path.dirname(configPath);
            if (!fs.existsSync(configDir)) {
                fs.mkdirSync(configDir, { recursive: true });
            }
        }
        fs.writeFileSync(configPath, existing + "\n" + section + "\n");
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
    override updateConfig(configPath: string, env: Record<string, string>, isReadOnly: boolean): void {
        const opencodeConfig = this.readOpenCodeConfig(configPath);
        if (!opencodeConfig.mcp) {
            opencodeConfig.mcp = {};
        }
        const args = ["-y", "mongodb-mcp-server@latest"];
        if (isReadOnly) {
            args.push("--readOnly");
        }
        opencodeConfig.mcp["mongodb-mcp-server"] = {
            type: "local",
            // Open Code uses a single array command and groups args within the command array
            command: ["npx", ...args],
            environment: Object.keys(env).length > 0 ? env : undefined,
            enabled: true,
        };
        const configDir = path.dirname(configPath);
        if (!fs.existsSync(configDir)) {
            fs.mkdirSync(configDir, { recursive: true });
        }
        fs.writeFileSync(configPath, JSON.stringify(opencodeConfig, null, 2));
    }

    protected readOpenCodeConfig(configPath: string): OpenCodeConfig {
        if (!fs.existsSync(configPath)) {
            return { mcp: {} };
        }
        try {
            const content = fs.readFileSync(configPath, "utf-8");
            const config = JSON.parse(content) as OpenCodeConfig;
            if (!config.mcp || typeof config.mcp !== "object") {
                config.mcp = {};
            }
            return config;
        } catch (e: unknown) {
            console.error(`Warning: Could not parse existing opencode.json. Error is: ${formatError(e)}`);
            return { mcp: {} };
        }
    }
}

export const AI_TOOL_REGISTRY: Record<AIToolType, AITool> = {
    ["cursor"]: new Cursor(),
    ["vscode"]: new VSCode(),
    ["windsurf"]: new Windsurf(),
    ["claudeDesktop"]: new ClaudeDesktop(),
    ["claudeCode"]: new ClaudeCode(),
    ["codex"]: new Codex(),
    ["opencode"]: new OpenCode(),
};
