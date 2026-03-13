/* eslint-disable no-console */
import select from "@inquirer/select";
import { input, confirm, password } from "@inquirer/prompts";
import path from "path";
import chalk from "chalk";
import semver from "semver";
import { NodeDriverServiceProvider } from "@mongosh/service-provider-node-driver";
import type { AIToolType } from "./aiTool.js";
import { AI_TOOL_REGISTRY, openConfigSettings, TOOLS_WITHOUT_EDITORS } from "./aiTool.js";
import { formatError, getPlatform } from "./setupAiToolsUtils.js";
import { packageInfo } from "../common/packageInfo.js";
import { getAuthType } from "../common/connectionInfo.js";
import { type UserConfig } from "../common/config/userConfig.js";

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
    tool: AIToolType,
    connectionString: string,
    serviceWorkerId: string,
    serviceWorkerSecret: string,
    isReadOnly: boolean
): Promise<void> => {
    const { name: displayName, configFileName } = AI_TOOL_REGISTRY[tool];
    let { configPath } = AI_TOOL_REGISTRY[tool];

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
    AI_TOOL_REGISTRY[tool].updateConfig(configPath, env, isReadOnly);
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

export const runSetup = async (config: UserConfig): Promise<void> => {
    try {
        console.log(chalk.hex("#00ED64")(banner) + "\n");

        const nodeVersion = process.versions.node;
        const requiredNodeRange = packageInfo.engines.node;
        if (!nodeVersion || !semver.satisfies(nodeVersion, requiredNodeRange)) {
            console.log(
                chalk.red(
                    `Node version satisfying "${requiredNodeRange}" is required for the MongoDB Local MCP Server. Current version: ${nodeVersion ?? "unknown"}. Please install or activate a compatible version.\n`
                )
            );
            process.exit(1);
        }

        const platform = getPlatform();
        if (!platform) {
            console.log(chalk.red("Unsupported platform. Only macOS, Windows and Linux are supported.\n"));
            process.exit(1);
        }

        console.log("To install a Local MCP Server configuration, you will need at least ONE of the following:");
        console.log("1. A MongoDB connection string (requires a cluster or local MongoDB instance)");
        console.log("2. Your Atlas project's Service Account credentials\n");
        console.log(
            "It's best to have this information at hand. We will not store any data or credentials in this process.\n\n"
        );

        const tool = await select<AIToolType>({
            message: "What tool would you like to use the MongoDB MCP Server with?",
            choices: [
                { value: "cursor", name: "Cursor" },
                { value: "vscode", name: "VS Code" },
                { value: "claudeDesktop", name: "Claude Desktop" },
                { value: "claudeCode", name: "Claude Code" },
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
        let connectionString = await password({
            message: "Enter your MongoDB connection string (press enter to skip):",
            mask: true,
        });

        if (connectionString) {
            try {
                const auth = getAuthType(config, connectionString);
                if (auth === "scram") {
                    const shouldTest = await confirm({ message: "Test your connection string?", default: true });

                    if (shouldTest) {
                        connectionString = await testConnectionString(connectionString);
                    }
                }
                // eslint-disable-next-line @typescript-eslint/no-unused-vars
            } catch (error: unknown) {
                // silently fail and continue, we will not prompt the user to enter a new connection string
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

        // If either the connection string is missing or one of the service account credentials, throw error
        if (!connectionString && (!serviceAccountId || !serviceAccountSecret)) {
            console.log(
                chalk.red("Please try setting up again with connection string or service account credentials.\n")
            );
            process.exit(1);
            return;
        }

        await configureEditor(tool, connectionString, serviceAccountId, serviceAccountSecret, isReadOnly);

        const availablePrompts: string[] = [];
        if (connectionString) {
            availablePrompts.push('\t"List the collections in my Atlas cluster"');
            availablePrompts.push('\t"Show me some db stats about my Atlas cluster"');
        }

        if (serviceAccountId && serviceAccountSecret) {
            availablePrompts.push('\t"What are the clusters in my project?"');
            availablePrompts.push('\t"Does my project have any active alerts?"');
        }

        console.log(
            chalk.green(
                `\nSetup complete! You can now use the MongoDB MCP Server in ${displayName}. You will probably need to restart your application to see the changes.\n`
            )
        );

        // Show keyboard shortcut hint for opening agent/copilot panel
        if (AI_TOOL_REGISTRY[tool].tip) {
            console.log(chalk.cyan(AI_TOOL_REGISTRY[tool].tip));
        }

        console.log("Try a query to get started:\n");
        console.log(availablePrompts.join("\n"));
        console.log("\n");

        // TODO: support opening files in Windows in CLOUDP-385463
        if (platform !== "windows") {
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
