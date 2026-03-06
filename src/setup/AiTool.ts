/* eslint-disable no-console */
import fs from "fs";
import path from "path";
import os from "os";
import { AI_TOOLS, type AiToolType } from "./setupAiToolsConstants.js";
import { formatError, getPlatform, type Platform } from "./setupAiToolsUtils.js";

const platform: Platform | null = getPlatform();
const isWindows = platform === "windows";
const isMac = platform === "mac";
const isLinux = platform === "linux";

const windowsBasePath = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");

export interface McpServerConfig {
    command: string;
    args: string[];
    env: Record<string, string>;
}

export interface McpConfig {
    mcpServers?: Record<string, McpServerConfig>;
    servers?: Record<string, McpServerConfig>;
}

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

function buildMcpServerConfig(isReadOnly: boolean, env: Record<string, string>): McpServerConfig {
    const args = ["-y", "mongodb-mcp-server@latest"];
    if (isReadOnly) {
        args.push("--readOnly");
    }
    return {
        command: "npx",
        args,
        env,
    };
}

function writeConfigFile(configPath: string, config: McpConfig): void {
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
}

export abstract class AiTool {
    abstract name: string;
    abstract configFileName: string;
    abstract get configPath(): string;
    tip?: string;

    /**
     * Key used in the config file for the MCP servers object.
     * Override in subclasses (e.g. VS Code uses "servers").
     */
    protected getServersKey(): "servers" | "mcpServers" {
        return "mcpServers";
    }

    protected readConfig(configPath: string): McpConfig {
        const serversKey = this.getServersKey();
        let config: McpConfig = { [serversKey]: {} };
        if (fs.existsSync(configPath)) {
            try {
                const existingContent = fs.readFileSync(configPath, "utf-8");
                config = JSON.parse(existingContent) as McpConfig;
                if (!config[serversKey]) {
                    config[serversKey] = {};
                }
            } catch (e: unknown) {
                console.error(
                    `Warning: Could not parse existing ${this.configFileName}, creating new config. Error is: ${formatError(e)}`
                );
                config = { [serversKey]: {} };
            }
        }
        return config;
    }

    updateConfig(configPath: string, env: Record<string, string>, isReadOnly: boolean): void {
        const config = this.readConfig(configPath);
        const serversKey = this.getServersKey();
        if (!config[serversKey]) {
            config[serversKey] = {};
        }
        config[serversKey]["mongodb-mcp-server"] = buildMcpServerConfig(isReadOnly, env);
        writeConfigFile(configPath, config);
    }
}

class Cursor extends AiTool {
    name = "Cursor";
    configFileName = "mcp.json";
    get configPath(): string {
        if (isWindows) {
            return path.join(windowsBasePath, "Cursor", "mcp.json");
        }
        if (isMac || isLinux) {
            return path.join(os.homedir(), ".cursor", "mcp.json");
        }
        return "";
    }
    tip = `Tip: Press ${isMac ? "Cmd+I" : "Ctrl+I"} in Cursor to open the Agent panel.\n`;
}

class VSCode extends AiTool {
    name = "VS Code";
    configFileName = "mcp.json";
    protected override getServersKey(): "servers" | "mcpServers" {
        return "servers";
    }
    get configPath(): string {
        if (isWindows) {
            return path.join(windowsBasePath, "Code", "User", "mcp.json");
        }
        if (isMac) {
            return path.join(os.homedir(), "Library", "Application Support", "Code", "User", "mcp.json");
        }
        if (isLinux) {
            return path.join(os.homedir(), ".config", "Code", "User", "mcp.json");
        }
        return "";
    }
    tip = `Tip: Press ${isMac ? "Cmd+Shift+I" : "Ctrl+Shift+I"} in VS Code to open the Copilot panel.\n`;
}

class Windsurf extends AiTool {
    name = "Windsurf";
    configFileName = "mcp_config.json";
    get configPath(): string {
        if (isWindows) {
            return path.join(windowsBasePath, "cascade", "mcp_config.json");
        }
        if (isMac || isLinux) {
            return path.join(os.homedir(), ".config", "cascade", "mcp_config.json");
        }
        return "";
    }
    tip = `Tip: Press ${isMac ? "Cmd+L" : "Ctrl+L"} in Windsurf to open the AI panel.\n`;
}

class ClaudeDesktop extends AiTool {
    name = "Claude Desktop";
    configFileName = "claude_desktop_config.json";
    get configPath(): string {
        if (isWindows) {
            return path.join(windowsBasePath, "Claude", "claude_desktop_config.json");
        }
        if (isMac) {
            return path.join(os.homedir(), "Library", "Application Support", "Claude", "claude_desktop_config.json");
        }
        if (isLinux) {
            return path.join(os.homedir(), ".config", "Claude", "claude_desktop_config.json");
        }
        return "";
    }
}

class ClaudeCode extends AiTool {
    name = "Claude Code";
    configFileName = ".claude.json";
    get configPath(): string {
        return path.join(os.homedir(), ".claude.json");
    }
}

class Codex extends AiTool {
    name = "OpenAI Codex";
    configFileName = "config.toml";
    get configPath(): string {
        return path.join(os.homedir(), ".codex", "config.toml");
    }

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

class OpenCode extends AiTool {
    name = "Open Code";
    configFileName = "opencode.json";
    get configPath(): string {
        return path.join(os.homedir(), ".config", "opencode", "opencode.json");
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

    private readOpenCodeConfig(configPath: string): OpenCodeConfig {
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

export const AI_TOOL_REGISTRY: Record<AiToolType, AiTool> = {
    [AI_TOOLS.CURSOR]: new Cursor(),
    [AI_TOOLS.VSCODE]: new VSCode(),
    [AI_TOOLS.WINDSURF]: new Windsurf(),
    [AI_TOOLS.CLAUDE_DESKTOP]: new ClaudeDesktop(),
    [AI_TOOLS.CLAUDE_CODE]: new ClaudeCode(),
    [AI_TOOLS.CODEX]: new Codex(),
    [AI_TOOLS.OPENCODE]: new OpenCode(),
};
