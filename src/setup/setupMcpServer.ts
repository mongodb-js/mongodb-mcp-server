/* eslint-disable no-console */
import select from "@inquirer/select";
import { input, confirm, password } from "@inquirer/prompts";
import fs from "fs";
import path from "path";
import os from "os";
import { exec } from "child_process";
import chalk from "chalk";
import semver from "semver";
import { MongoClient } from "mongodb";
import { EDITOR_CONFIGS, EDITORS, type EditorType } from "./setupEditorConstants.js";

const MINIMUM_REQUIRED_NODE_VERSION = "22.12.0";
const MINIMUM_REQUIRED_MCP_NODE22_VERSION = "22.12.0";

interface McpServerConfig {
    command: string;
    args: string[];
    env: Record<string, string>;
}

interface McpConfig {
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

/** Format an unknown catch value for display (Error.message or String). */
const formatError = (error: unknown): string => (error instanceof Error ? error.message : String(error));

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

const EDITORS_WITHOUT_PROTOCOL: EditorType[] = [
    EDITORS.CLAUDE_DESKTOP,
    EDITORS.CLAUDE_CODE,
    EDITORS.CODEX,
    EDITORS.OPENCODE,
];

const openEditorSettings = (editor: EditorType): void => {
    const configPath = EDITOR_CONFIGS[editor].getConfigPath();

    if (EDITORS_WITHOUT_PROTOCOL.includes(editor)) {
        if (isMac) {
            exec(`open "${configPath}"`);
        } else if (isWindows) {
            exec(`start "" "${configPath}"`);
        } else {
            exec(`xdg-open "${configPath}"`);
        }
        return;
    }

    const protocol = editor;
    if (isMac) {
        exec(`open "${protocol}://file${configPath}"`);
    } else if (isWindows) {
        exec(`start "" "${protocol}://file${configPath}"`);
    } else {
        exec(`xdg-open "${protocol}://file${configPath}"`);
    }
};

const getEditorConfigPath = (editor: EditorType): string => {
    return EDITOR_CONFIGS[editor].getConfigPath();
};

const getEditorDisplayName = (editor: EditorType): string => {
    return EDITOR_CONFIGS[editor].name;
};

const getConfigFileName = (editor: EditorType): string => {
    return EDITOR_CONFIGS[editor].configFileName;
};

const getServersKey = (editor: EditorType): "servers" | "mcpServers" | null => {
    // VS Code uses "servers" at the top level; Cursor, Windsurf, Claude Desktop, Claude Code use "mcpServers"
    if (editor === "vscode") return "servers";
    if (editor === "cursor" || editor === "windsurf" || editor === "claudeDesktop" || editor === "claudeCode") {
        return "mcpServers";
    }
    // OpenCode uses "mcp" (different shape); Codex uses TOML — handled separately
    return null;
};

const readExistingConfig = (configPath: string, configFileName: string, editor: EditorType): McpConfig => {
    const serversKey = getServersKey(editor);
    if (serversKey === null) {
        return {};
    }
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
                `Warning: Could not parse existing ${configFileName}, creating new config. Error is: ${formatError(e)}`
            );
            config = { [serversKey]: {} };
        }
    }
    return config;
};

const readOpenCodeConfig = (configPath: string): OpenCodeConfig => {
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
};

const appendCodexTomlSection = (configPath: string, env: Record<string, string>, isReadOnly: boolean): void => {
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
            console.log(chalk.red("\n✗ Connection failed: " + formatError(error)));
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

    const env = buildEnvObject(connectionString, serviceWorkerId, serviceWorkerSecret);

    if (editor === EDITORS.OPENCODE) {
        const opencodeConfig = readOpenCodeConfig(configPath);
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
    } else if (editor === EDITORS.CODEX) {
        appendCodexTomlSection(configPath, env, isReadOnly);
    } else {
        const config = readExistingConfig(configPath, configFileName, editor);
        const serversKey = getServersKey(editor);
        if (serversKey === null) {
            throw new Error(`Unsupported editor: ${editor}`);
        }
        if (!config[serversKey]) {
            config[serversKey] = {};
        }
        const mcpServerConfig = buildMcpServerConfig(isReadOnly, env);
        config[serversKey]["mongodb-mcp-server"] = mcpServerConfig;
        writeConfigFile(configPath, config);
    }
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

export const runSetup = async (): Promise<void> => {
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

        console.log("To install a Local MCP Server configuration, you'll need:");
        console.log("1. A MongoDB Cluster");
        console.log("2. The connection string for your Cluster, including SCRAM database user credentials [required]");
        console.log("3. The credentials for your project's Service Account [recommended]\n");
        console.log(
            "It's best to have this information at hand. We will not store any data or credentials in this process.\n\n"
        );

        const editor = (await select({
            message: "What tool would you like to use the MongoDB MCP Server with?",
            choices: [
                { value: EDITORS.CURSOR, name: "Cursor" },
                { value: EDITORS.VSCODE, name: "VS Code" },
                { value: EDITORS.CLAUDE_DESKTOP, name: "Claude Desktop" },
                { value: EDITORS.CLAUDE_CODE, name: "Claude Code" },
                { value: EDITORS.CODEX, name: "OpenAI Codex" },
                { value: EDITORS.OPENCODE, name: "Open Code" },
                { value: EDITORS.WINDSURF, name: "Windsurf" },
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
        } else if (editor === "claudeCode") {
            console.log(chalk.cyan("Tip: Use the /config command in Claude Code to open Settings.\n"));
        } else if (editor === "codex") {
            console.log(chalk.cyan("Tip: In Codex, use MCP settings > Open config.toml from the gear menu.\n"));
        } else if (editor === "opencode") {
            console.log(
                chalk.cyan("Tip: Open Code uses opencode.json for MCP; edit in your project or global config.\n")
            );
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
};
