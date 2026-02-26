#!/usr/bin/env node
import select from "@inquirer/select";
import { input, confirm, password } from "@inquirer/prompts";
import fs from "fs";
import path from "path";
import os from "os";
import { exec } from "child_process";
import chalk from "chalk";
import semver from "semver";
import { MongoClient } from "mongodb";

const MINIMUM_REQUIRED_NODE_VERSION = "22.12.0";
const MINIMUM_REQUIRED_MCP_NODE22_VERSION = "22.12.0";

type EditorType = "cursor" | "vscode" | "windsurf" | "claudeDesktop";

interface McpServerConfig {
    command: string;
    args: string[];
    env: Record<string, string>;
}

interface McpConfig {
    mcpServers?: Record<string, McpServerConfig>;
    servers?: Record<string, McpServerConfig>;
}

// Handle Ctrl+C gracefully
process.on("SIGINT", () => {
    console.log("\n\nSetup cancelled. Goodbye!");
    process.exit(0);
});

// Detect OS
const platform = os.platform();
const isWindows = platform === "win32";
const isMac = platform === "darwin";

const getCurrentNodeVersion = (): string => {
    const version = process.versions.node;
    return version;
};

const openEditorSettings = (editor: EditorType): void => {
    let configPath;
    let protocol;

    if (editor === "cursor") {
        configPath = getCursorConfigPath();
        protocol = "cursor";
    } else if (editor === "vscode") {
        configPath = getVSCodeConfigPath();
        protocol = "vscode";
    } else if (editor === "windsurf") {
        configPath = getWindsurfConfigPath();
        protocol = "windsurf";
    } else if (editor === "claudeDesktop") {
        // Claude Desktop doesn't have a URL protocol, open config file in default editor
        configPath = getClaudeDesktopConfigPath();
        if (isMac) {
            exec(`open "${configPath}"`);
        } else if (isWindows) {
            exec(`start "" "${configPath}"`);
        } else {
            exec(`xdg-open "${configPath}"`);
        }
        return;
    }

    if (isMac) {
        exec(`open "${protocol}://file${configPath}"`);
    } else if (isWindows) {
        exec(`start "" "${protocol}://file${configPath}"`);
    } else {
        exec(`xdg-open "${protocol}://file${configPath}"`);
    }
};

const getCursorConfigPath = (): string => {
    if (isWindows) {
        // Windows: %APPDATA%\Cursor\mcp.json
        return path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "Cursor", "mcp.json");
    } else if (isMac) {
        // macOS: ~/.cursor/mcp.json
        return path.join(os.homedir(), ".cursor", "mcp.json");
    } else {
        // Linux: ~/.cursor/mcp.json
        return path.join(os.homedir(), ".cursor", "mcp.json");
    }
};

const getWindsurfConfigPath = (): string => {
    if (isWindows) {
        // Windows: %APPDATA%\Windsurf\mcp_config.json
        return path.join(
            process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"),
            "Windsurf",
            "mcp_config.json"
        );
    } else if (isMac) {
        // macOS: ~/.codeium/windsurf/mcp_config.json
        return path.join(os.homedir(), ".codeium", "windsurf", "mcp_config.json");
    } else {
        // Linux: ~/.codeium/windsurf/mcp_config.json
        return path.join(os.homedir(), ".codeium", "windsurf", "mcp_config.json");
    }
};

const getClaudeDesktopConfigPath = (): string => {
    if (isWindows) {
        // Windows: %APPDATA%\Claude\claude_desktop_config.json
        return path.join(
            process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"),
            "Claude",
            "claude_desktop_config.json"
        );
    } else if (isMac) {
        // macOS: ~/Library/Application Support/Claude/claude_desktop_config.json
        return path.join(os.homedir(), "Library", "Application Support", "Claude", "claude_desktop_config.json");
    } else {
        // Linux: ~/.config/Claude/claude_desktop_config.json
        return path.join(os.homedir(), ".config", "Claude", "claude_desktop_config.json");
    }
};

const getVSCodeConfigPath = (): string => {
    if (isWindows) {
        // Windows: %APPDATA%\Code\User\mcp.json
        return path.join(
            process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"),
            "Code",
            "User",
            "mcp.json"
        );
    } else if (isMac) {
        // macOS: ~/Library/Application Support/Code/User/mcp.json
        return path.join(os.homedir(), "Library", "Application Support", "Code", "User", "mcp.json");
    } else {
        // Linux: ~/.config/Code/User/mcp.json
        return path.join(os.homedir(), ".config", "Code", "User", "mcp.json");
    }
};

const getEditorConfigPath = (editor: EditorType): string => {
    if (editor === "windsurf") return getWindsurfConfigPath();
    if (editor === "claudeDesktop") return getClaudeDesktopConfigPath();
    if (editor === "vscode") return getVSCodeConfigPath();
    return getCursorConfigPath();
};

const getEditorDisplayName = (editor: EditorType): string => {
    if (editor === "windsurf") return "Windsurf";
    if (editor === "claudeDesktop") return "Claude Desktop";
    if (editor === "vscode") return "VS Code";
    return "Cursor";
};

const getConfigFileName = (editor: EditorType): string => {
    if (editor === "windsurf") return "mcp_config.json";
    if (editor === "claudeDesktop") return "claude_desktop_config.json";
    return "mcp.json";
};

const getServersKey = (editor: EditorType): "servers" | "mcpServers" => {
    // VS Code uses "servers" at the top level, others use "mcpServers"
    if (editor === "vscode") return "servers";
    return "mcpServers";
};

const readExistingConfig = (configPath: string, configFileName: string, editor: EditorType): McpConfig => {
    const serversKey = getServersKey(editor);
    let config: McpConfig = { [serversKey]: {} };
    if (fs.existsSync(configPath)) {
        try {
            const existingContent = fs.readFileSync(configPath, "utf-8");
            config = JSON.parse(existingContent) as McpConfig;
            if (!config[serversKey]) {
                config[serversKey] = {};
            }
        } catch (e: unknown) {
            console.error(`Warning: Could not parse existing ${configFileName}, creating new config. Error is: ${e}`);
            config = { [serversKey]: {} };
        }
    }
    return config;
};

const buildEnvObject = (
    connectionString: string,
    serviceWorkerId: string,
    serviceWorkerSecret: string
): Record<string, string> => {
    const env: Record<string, string> = {};
    if (connectionString) {
        env.MDB_MCP_CONNECTION_STRING = connectionString;
    }
    if (serviceWorkerId) {
        env.MDB_MCP_API_CLIENT_ID = serviceWorkerId;
    }
    if (serviceWorkerSecret) {
        env.MDB_MCP_API_CLIENT_SECRET = serviceWorkerSecret;
    }
    return env;
};

const buildMcpServerConfig = (isReadOnly: boolean, env: Record<string, string>): McpServerConfig => {
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
    const configDir = path.dirname(configPath);
    if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
    }
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
};

const testConnectionString = async (initialConnectionString: string): Promise<string> => {
    let connectionString = initialConnectionString;
    let connectionSuccessful = false;

    while (!connectionSuccessful) {
        console.log("\nTesting connection...");
        let client;

        try {
            client = new MongoClient(connectionString, {
                serverSelectionTimeoutMS: 10000,
            });
            await client.connect();
            await client.db("admin").command({ ping: 1 });
            console.log(chalk.green("✓ Connection successful!"));
            connectionSuccessful = true;
        } catch (error: unknown) {
            console.log(
                chalk.red("\n✗ Connection failed: " + (error instanceof Error ? error.message : String(error)))
            );
            console.log(chalk.yellow("\nPlease check:"));
            console.log(chalk.yellow("  • Your database user credentials are correct"));
            console.log(chalk.yellow("  • Your IP address is allowed in Network Access"));
            console.log(chalk.yellow("  • The cluster is running and accessible"));

            const retry = await confirm({
                message: "\nWould you like to enter a new connection string and try again?",
                default: true,
            });

            if (retry) {
                connectionString = await password({ message: "Enter your MongoDB connection string:", mask: true });
            } else {
                connectionSuccessful = true; // Exit loop, proceed with potentially invalid connection string
            }
        } finally {
            try {
                await client?.close();
            } catch {
                // Ignore close errors
            }
        }
    }

    return connectionString;
};

const configureEditor = async (
    editor: EditorType,
    connectionString: string,
    serviceWorkerId: string,
    serviceWorkerSecret: string,
    isReadOnly: boolean
): Promise<void> => {
    const displayName = getEditorDisplayName(editor);
    const configFileName = getConfigFileName(editor);
    let configPath = getEditorConfigPath(editor);

    // Confirm the config path with the user
    const useDetectedPath = await confirm({
        message: `Is this the correct path for your ${displayName} config?\n  ${configPath}`,
        default: true,
    });

    if (!useDetectedPath) {
        configPath = await input({
            message: `Enter the correct path to your ${displayName} ${configFileName} file:`,
            default: configPath,
        });
    }

    // Read existing config or start with empty object
    const config = readExistingConfig(configPath, configFileName, editor);

    // Build and add the mongodb-mcp-server entry
    const env = buildEnvObject(connectionString, serviceWorkerId, serviceWorkerSecret);
    const mcpServerConfig = buildMcpServerConfig(isReadOnly, env);

    const serversKey = getServersKey(editor);
    if (!config[serversKey]) {
        config[serversKey] = {};
    }
    config[serversKey]!["mongodb-mcp-server"] = mcpServerConfig;

    // Write the config file
    writeConfigFile(configPath, config);
    console.log(`\nConfiguration saved to ${configPath}`);
};

// Unicode block character banner with MongoDB leaf logo
const banner = `
       ▄▄
      ▟██▙    █▀▄▀█ █▀█ █▄ █ █▀▀ █▀█ █▀▄ █▄▄   █▀▄▀█ █▀▀ █▀█   █▀ █▀▀ █▀█ █ █ █▀▀ █▀█
     ▟████▙   █ ▀ █ █▄█ █ ▀█ █▄█ █▄█ █▄▀ █▄█   █ ▀ █ █▄▄ █▀▀   ▄█ ██▄ █▀▄ ▀▄▀ ██▄ █▀▄
     ▜████▛
      ▜██▛    █▀ █▀▀ ▀█▀ █ █ █▀█
       ▐▌     ▄█ ██▄  █  █▄█ █▀▀
  `;

await (async (): Promise<void> => {
    try {
        console.log(chalk.hex("#00ED64")(banner) + "\n");

        const nodeVersion = semver.coerce(getCurrentNodeVersion());
        const minimumRequiredNodeVersion = semver.coerce(MINIMUM_REQUIRED_NODE_VERSION);
        const minimumRequiredMcpNode22Version = semver.coerce(MINIMUM_REQUIRED_MCP_NODE22_VERSION);

        if (
            !nodeVersion ||
            !minimumRequiredNodeVersion ||
            !minimumRequiredMcpNode22Version ||
            semver.lt(nodeVersion, minimumRequiredNodeVersion)
        ) {
            console.error(
                `Node version >=${minimumRequiredNodeVersion?.toString() ?? MINIMUM_REQUIRED_NODE_VERSION} is required for the MongoDB Local MCP Server. Please install or activate a compatible version.`
            );
            process.exit(1);
        } else if (
            nodeVersion &&
            minimumRequiredMcpNode22Version &&
            nodeVersion.major === minimumRequiredMcpNode22Version.major &&
            nodeVersion.minor < minimumRequiredMcpNode22Version.minor
        ) {
            console.error(
                `Node version >=${minimumRequiredMcpNode22Version.toString()} is required for the MongoDB Local MCP Server. Please install or activate a compatible version.`
            );
            process.exit(1);
        }

        console.log("To install a Local MCP Server configuration, you’ll need:");
        console.log("1. A MongoDB Cluster");
        console.log("2. The connection string for your Cluster, including SCRAM database user credentials [required]");
        console.log("3. The credentials for your project’s Service Account [recommended]\n");
        console.log(
            "It’s best to have this information at hand. We will not store any data or credentials in this process.\n\n"
        );

        const editor = (await select({
            message: "What tool would you like to use the MongoDB MCP Server with?",
            choices: [
                {
                    value: "cursor",
                    name: "Cursor",
                },
                {
                    value: "vscode",
                    name: "VS Code",
                },
                {
                    value: "claudeDesktop",
                    name: "Claude Desktop",
                },
                {
                    value: "windsurf",
                    name: "Windsurf",
                },
            ],
        })) as EditorType;
        console.log("\n");

        let connectionString = "";
        let serviceWorkerId = "";
        let serviceWorkerSecret = "";

        const isReadOnly = await confirm({ message: "Install MCP server as Read-only?", default: false });
        console.log("\n");

        console.log(
            "Providing a connection string allows the MCP server to read and write data to your MongoDB cluster."
        );
        connectionString = await password({ message: "Enter your MongoDB connection string:", mask: true });

        if (connectionString) {
            const shouldTest = await confirm({ message: "Test your connection string?", default: true });

            if (shouldTest) {
                connectionString = await testConnectionString(connectionString);
            }
        }

        console.log(
            "\nService Accounts allow the MCP Server to access your MongoDB cluster and perform actions on your behalf."
        );
        serviceWorkerId = await input({ message: "Enter your Atlas Service Account Client ID (press enter to skip):" });
        serviceWorkerSecret = await password({
            message: "Enter your Atlas Service Account Secret (press enter to skip):",
            mask: true,
        });
        console.log("\n");

        await configureEditor(editor, connectionString, serviceWorkerId, serviceWorkerSecret, isReadOnly);

        const availablePrompts = [];
        if (connectionString) {
            availablePrompts.push('\t"List the collections in my Atlas cluster"');
            availablePrompts.push('\t"Show me some db stats about my Atlas cluster"');
        }

        if (serviceWorkerId && serviceWorkerSecret) {
            availablePrompts.push('\t"What are the clusters in my project"');
            availablePrompts.push('\t"Does my project have any active alerts"');
        }

        console.log(chalk.green("\nSetup complete! You can now use the MongoDB MCP Server in your editor.\n"));

        // Show keyboard shortcut hint for opening agent/copilot panel
        if (editor === "cursor") {
            console.log(chalk.cyan(`Tip: Press ${isMac ? "Cmd+I" : "Ctrl+I"} in Cursor to open the Agent panel.\n`));
        } else if (editor === "vscode") {
            console.log(
                chalk.cyan(
                    `Tip: Press ${isMac ? "Cmd+Shift+I" : "Ctrl+Shift+I"} in VS Code to open the Copilot panel.\n`
                )
            );
        } else if (editor === "windsurf") {
            console.log(chalk.cyan(`Tip: Press ${isMac ? "Cmd+L" : "Ctrl+L"} in Windsurf to open the AI panel.\n`));
        }

        console.log("Try a query to get started:\n");
        console.log(availablePrompts.join("\n"));
        console.log("\n");

        const openConfig = await confirm({
            message: `Would you like to open the config file in ${getEditorDisplayName(editor)}?`,
            default: true,
        });

        if (openConfig) {
            openEditorSettings(editor);
        }
    } catch (error: unknown) {
        // Handle Ctrl+C during prompts (inquirer throws ExitPromptError)
        if (error && typeof error === "object" && "name" in error && error.name === "ExitPromptError") {
            console.log("\n\nSetup cancelled. Goodbye!");
            process.exit(0);
        }
        // Re-throw other errors
        throw error;
    }
})();
