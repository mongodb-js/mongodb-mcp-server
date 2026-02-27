import path from "path";
import os from "os";

const platform = os.platform();
const isWindows = platform === "win32";
const isMac = platform === "darwin";

export type EditorType = "cursor" | "vscode" | "windsurf" | "claudeDesktop";

export const EDITORS = {
    CURSOR: "cursor",
    VSCODE: "vscode",
    WINDSURF: "windsurf",
    CLAUDE_DESKTOP: "claudeDesktop",
} as const satisfies Record<string, EditorType>;

interface EditorConfig {
    name: string;
    configFileName: string;
    getConfigPath: () => string;
}

export const EDITOR_CONFIGS: Record<EditorType, EditorConfig> = {
    [EDITORS.CURSOR]: {
        name: "Cursor",
        configFileName: "mcp.json",
        getConfigPath: (): string => {
            if (isWindows) {
                return path.join(
                    process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"),
                    "Cursor",
                    "mcp.json"
                );
            }
            // macOS & Linux: ~/.cursor/mcp.json
            return path.join(os.homedir(), ".cursor", "mcp.json");
        },
    },
    [EDITORS.VSCODE]: {
        name: "VS Code",
        configFileName: "mcp.json",
        getConfigPath: (): string => {
            if (isWindows) {
                return path.join(
                    process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"),
                    "Code",
                    "User",
                    "mcp.json"
                );
            }
            if (isMac) {
                return path.join(os.homedir(), "Library", "Application Support", "Code", "User", "mcp.json");
            }
            // Linux: ~/.config/Code/User/mcp.json
            return path.join(os.homedir(), ".config", "Code", "User", "mcp.json");
        },
    },
    [EDITORS.WINDSURF]: {
        name: "Windsurf",
        configFileName: "mcp_config.json",
        getConfigPath: (): string => {
            if (isWindows) {
                return path.join(
                    process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"),
                    "Windsurf",
                    "mcp_config.json"
                );
            }
            // macOS & Linux: ~/.codeium/windsurf/mcp_config.json
            return path.join(os.homedir(), ".codeium", "windsurf", "mcp_config.json");
        },
    },
    [EDITORS.CLAUDE_DESKTOP]: {
        name: "Claude Desktop",
        configFileName: "claude_desktop_config.json",
        getConfigPath: (): string => {
            if (isWindows) {
                return path.join(
                    process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"),
                    "Claude",
                    "claude_desktop_config.json"
                );
            }
            if (isMac) {
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
};
