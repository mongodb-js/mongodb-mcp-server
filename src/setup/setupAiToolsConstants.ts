import path from "path";
import os from "os";

const platform = os.platform();
const isWindows = platform === "win32";
const isMac = platform === "darwin";

export type AiToolType = "cursor" | "vscode" | "windsurf" | "claudeDesktop" | "claudeCode" | "codex" | "opencode";

export const AI_TOOLS = {
    CURSOR: "cursor",
    VSCODE: "vscode",
    WINDSURF: "windsurf",
    CLAUDE_DESKTOP: "claudeDesktop",
    CLAUDE_CODE: "claudeCode",
    CODEX: "codex",
    OPENCODE: "opencode",
} as const satisfies Record<string, AiToolType>;

interface AiToolConfig {
    name: string;
    configFileName: string;
    getConfigPath: () => string;
}

const windowsBasePath = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");

export const AI_TOOL_CONFIGS: Record<AiToolType, AiToolConfig> = {
    [AI_TOOLS.CURSOR]: {
        name: "Cursor",
        configFileName: "mcp.json",
        getConfigPath: (): string => {
            if (isWindows) {
                // windows: %APPDATA%\Cursor\mcp.json
                return path.join(windowsBasePath, "Cursor", "mcp.json");
            }
            // macOS & Linux: ~/.cursor/mcp.json
            return path.join(os.homedir(), ".cursor", "mcp.json");
        },
    },
    [AI_TOOLS.VSCODE]: {
        name: "VS Code",
        configFileName: "mcp.json",
        getConfigPath: (): string => {
            if (isWindows) {
                // windows: %APPDATA%\Code\User\mcp.json
                return path.join(windowsBasePath, "Code", "User", "mcp.json");
            }
            if (isMac) {
                // macOS: ~/Library/Application Support/Code/User/mcp.json
                return path.join(os.homedir(), "Library", "Application Support", "Code", "User", "mcp.json");
            }
            // Linux: ~/.config/Code/User/mcp.json
            return path.join(os.homedir(), ".config", "Code", "User", "mcp.json");
        },
    },
    [AI_TOOLS.WINDSURF]: {
        name: "Windsurf",
        configFileName: "mcp_config.json",
        getConfigPath: (): string => {
            if (isWindows) {
                // windows: %APPDATA%\cascade\mcp_config.json
                return path.join(windowsBasePath, "cascade", "mcp_config.json");
            }
            // macOS & Linux: ~/.config/cascade/mcp_config.json
            return path.join(os.homedir(), ".config", "cascade", "mcp_config.json");
        },
    },
    [AI_TOOLS.CLAUDE_DESKTOP]: {
        name: "Claude Desktop",
        configFileName: "claude_desktop_config.json",
        getConfigPath: (): string => {
            if (isWindows) {
                // windows: %APPDATA%\Claude\claude_desktop_config.json
                return path.join(windowsBasePath, "Claude", "claude_desktop_config.json");
            }
            if (isMac) {
                // macOS: ~/Library/Application Support/Claude/claude_desktop_config.json
                return path.join(
                    os.homedir(),
                    "Library",
                    "Application Support",
                    "Claude",
                    "claude_desktop_config.json"
                );
            }
            // Linux: ~/.config/Claude/claude_desktop_config.json
            return path.join(os.homedir(), ".config", "Claude", "claude_desktop_config.json");
        },
    },
    [AI_TOOLS.CLAUDE_CODE]: {
        name: "Claude Code",
        configFileName: ".claude.json",
        getConfigPath: (): string => {
            // macOS/Linux: ~/.claude.json
            // windows: %USERPROFILE%\.claude.json
            return path.join(os.homedir(), ".claude.json");
        },
    },
    [AI_TOOLS.CODEX]: {
        name: "OpenAI Codex",
        configFileName: "config.toml",
        getConfigPath: (): string => {
            // macOS/Linux: ~/.codex/config.toml
            // windows: %USERPROFILE%\.codex\config.toml (user-level only; not /etc/codex)
            return path.join(os.homedir(), ".codex", "config.toml");
        },
    },
    [AI_TOOLS.OPENCODE]: {
        name: "Open Code",
        configFileName: "opencode.json",
        getConfigPath: (): string => {
            // macOS/Linux: ~/.config/opencode/opencode.json
            // windows: %USERPROFILE%\.config\opencode\opencode.json
            return path.join(os.homedir(), ".config", "opencode", "opencode.json");
        },
    },
};
