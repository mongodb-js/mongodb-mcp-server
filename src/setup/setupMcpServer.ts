/* eslint-disable no-console */
import select from "@inquirer/select";
import { input, confirm, password } from "@inquirer/prompts";
import path from "path";
import { exec } from "child_process";
import chalk from "chalk";
import semver from "semver";
import { NodeDriverServiceProvider } from "@mongosh/service-provider-node-driver";
import { AI_TOOLS, type AiToolType } from "./setupAiToolsConstants.js";
import { AI_TOOL_REGISTRY } from "./AiTool.js";
import type { Platform } from "./setupAiToolsUtils.js";
import { getPlatform } from "./setupAiToolsUtils.js";

const MINIMUM_REQUIRED_NODE_VERSION = "22.12.0";
const MINIMUM_REQUIRED_MCP_NODE22_VERSION = "22.12.0";

/** Format an unknown catch value for display (Error.message or String). */
const formatError = (error: unknown): string => (error instanceof Error ? error.message : String(error));

// Detect OS
const platform: Platform | null = getPlatform();
const isWindows = platform === "windows";
const isMac = platform === "mac";
const isLinux = platform === "linux";

// These are tools that don't have a designated editor to open the config file
const TOOLS_WITHOUT_EDITORS: AiToolType[] = [
    AI_TOOLS.CLAUDE_DESKTOP,
    AI_TOOLS.CLAUDE_CODE,
    AI_TOOLS.CODEX,
    AI_TOOLS.OPENCODE,
];

const openConfigSettings = (tool: AiToolType): void => {
    const configPath = AI_TOOL_REGISTRY[tool].configPath;

    if (TOOLS_WITHOUT_EDITORS.includes(tool)) {
        if (isMac) {
            exec(`open "${configPath}"`);
        } else if (isWindows) {
            exec(`start "" "${configPath}"`);
        } else if (isLinux) {
            exec(`xdg-open "${configPath}"`);
        }
        return;
    }

    const editor = tool;
    if (isMac) {
        exec(`open "${editor}://file${configPath}"`);
    } else if (isWindows) {
        exec(`start "" "${editor}://file${configPath}"`);
    } else if (isLinux) {
        exec(`xdg-open "${editor}://file${configPath}"`);
    }
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

const testConnectionString = async (connectionString: string): Promise<string> => {
    while (true) {
        console.log("\nTesting connection...");
        let serviceProvider: NodeDriverServiceProvider | undefined;

        try {
            serviceProvider = await NodeDriverServiceProvider.connect(connectionString, {
                productDocsLink: "https://github.com/mongodb-js/mongodb-mcp-server/",
                productName: "MongoDB MCP",
                serverSelectionTimeoutMS: 10000,
            });
            await serviceProvider.runCommand("admin", { ping: 1 });
            console.log(chalk.green("✓ Connection successful!"));
            return connectionString;
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
                console.log(chalk.yellow("\nYou might be proceeding with a potentially invalid connection string."));
                return connectionString; // Exit loop, proceed with potentially invalid connection string
            }
        } finally {
            try {
                await serviceProvider?.close();
            } catch {
                // Ignore close errors
            }
        }
    }

    return connectionString;
};

const configureEditor = async (
    tool: AiToolType,
    connectionString: string,
    serviceWorkerId: string,
    serviceWorkerSecret: string,
    isReadOnly: boolean
): Promise<void> => {
    const aiTool = AI_TOOL_REGISTRY[tool];
    const { name: displayName, configFileName } = aiTool;
    let configPath = aiTool.configPath;

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

    // Resolve to absolute path and trim so we always write to the intended file
    configPath = path.resolve(configPath.trim());

    const env = buildEnvObject(connectionString, serviceWorkerId, serviceWorkerSecret);
    aiTool.updateConfig(configPath, env, isReadOnly);
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

        const nodeVersion = semver.coerce(process.versions.node);
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

        if (!platform) {
            console.error("Unsupported platform. Only macOS, Windows and Linux are supported.");
            process.exit(1);
        }

        console.log("To install a Local MCP Server configuration, you'll need:");
        console.log("1. A MongoDB Cluster");
        console.log("2. The connection string for your Cluster, including SCRAM database user credentials [required]");
        console.log("3. The credentials for your project's Service Account [recommended]\n");
        console.log(
            "It's best to have this information at hand. We will not store any data or credentials in this process.\n\n"
        );

        const tool = await select<AiToolType>({
            message: "What tool would you like to use the MongoDB MCP Server with?",
            choices: [
                { value: "cursor", name: "Cursor" },
                { value: "vscode", name: "VS Code" },
                { value: "claudeDesktop", name: "Claude Desktop" },
                { value: "claudeCode", name: "Claude Code" },
                { value: "codex", name: "OpenAI Codex" },
                { value: "opencode", name: "Open Code" },
                { value: "windsurf", name: "Windsurf" },
            ],
        });
        const displayName = AI_TOOL_REGISTRY[tool].name;
        console.log("\n");

        const isReadOnly = await confirm({ message: "Install MCP server as Read-only?", default: false });
        console.log("\n");

        console.log(
            "Providing a connection string allows the MCP server to read and write data to your MongoDB cluster."
        );
        let connectionString = await password({ message: "Enter your MongoDB connection string:", mask: true });

        if (connectionString) {
            const shouldTest = await confirm({ message: "Test your connection string?", default: true });

            if (shouldTest) {
                connectionString = await testConnectionString(connectionString);
            }
        }

        console.log(
            "\nService Accounts allow the MCP Server to access Atlas tools and perform actions on your behalf."
        );
        const serviceAccountId = await input({
            message: "Enter your Atlas Service Account Client ID (press enter to skip):",
        });
        const serviceAccountSecret = await password({
            message: "Enter your Atlas Service Account Secret (press enter to skip):",
            mask: true,
        });
        console.log("\n");

        await configureEditor(tool, connectionString, serviceAccountId, serviceAccountSecret, isReadOnly);

        const availablePrompts = [];
        if (connectionString) {
            availablePrompts.push('\t"List the collections in my Atlas cluster"');
            availablePrompts.push('\t"Show me some db stats about my Atlas cluster"');
        }

        if (serviceAccountId && serviceAccountSecret) {
            availablePrompts.push('\t"What are the clusters in my project?"');
            availablePrompts.push('\t"Does my project have any active alerts?"');
        }

        if (availablePrompts.length === 0) {
            console.log(
                chalk.red("Please try setting up again with connection string or service account credentials.\n")
            );
            process.exit(1);
            return;
        }

        console.log(
            chalk.green(
                `\nSetup complete! You can now use the MongoDB MCP Server in ${displayName}. You may need to restart your application to see the changes.\n`
            )
        );

        // Show keyboard shortcut hint for opening agent/copilot panel
        if (AI_TOOL_REGISTRY[tool].tip) {
            console.log(chalk.cyan(AI_TOOL_REGISTRY[tool].tip));
        }

        console.log("Try a query to get started:\n");
        console.log(availablePrompts.join("\n"));
        console.log("\n");

        let openConfigMessage = `Would you like to open the config file in ${displayName}?`;
        if (TOOLS_WITHOUT_EDITORS.includes(tool)) {
            openConfigMessage = `Would you like to open the config file in your default editor?`;
        }
        const openConfig = await confirm({
            message: openConfigMessage,
            default: true,
        });

        if (openConfig) {
            openConfigSettings(tool);
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
