/* eslint-disable no-console */
import select from "@inquirer/select";
import { input, confirm, password } from "@inquirer/prompts";
import path from "path";
import chalk from "chalk";
import semver from "semver";
import { NodeDriverServiceProvider } from "@mongosh/service-provider-node-driver";
import type { AIToolType } from "./aiTool.js";
import { AI_TOOL_REGISTRY, openConfigSettings, TOOLS_WITHOUT_EDITORS } from "./aiTool.js";
import type { Platform } from "./setupAiToolsUtils.js";
import { formatError, getPlatform } from "./setupAiToolsUtils.js";
import { packageInfo } from "../common/packageInfo.js";
import { getAuthType } from "../common/connectionInfo.js";
import { type UserConfig } from "../common/config/userConfig.js";
import { defaultCreateAtlasLocalClient } from "../common/atlasLocal.js";
import { NullLogger } from "../common/logging/loggerBase.js";

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

const printNewLine = (): void => {
    console.log("\n");
};

const printLogo = (): void => {
    // Unicode block character banner with MongoDB leaf logo
    const banner = `
       ▄▄
      ▟██▙    █▀▄▀█ █▀█ █▄ █ █▀▀ █▀█ █▀▄ █▄▄   █▀▄▀█ █▀▀ █▀█   █▀ █▀▀ █▀█ █ █ █▀▀ █▀█
     ▟████▙   █ ▀ █ █▄█ █ ▀█ █▄█ █▄█ █▄▀ █▄█   █ ▀ █ █▄▄ █▀▀   ▄█ ██▄ █▀▄ ▀▄▀ ██▄ █▀▄
     ▜████▛
      ▜██▛    █▀ █▀▀ ▀█▀ █ █ █▀█
       ▐▌     ▄█ ██▄  █  █▄█ █▀▀
  `;
    console.log(chalk.hex("#00ED64")(banner));
    printNewLine();
};

const validateNodeVersion = (): void => {
    const nodeVersion = process.versions.node;
    const requiredNodeRange = packageInfo.engines.node;
    if (!nodeVersion || !semver.satisfies(nodeVersion, requiredNodeRange)) {
        console.log(
            chalk.red(
                `Node version satisfying "${requiredNodeRange}" is required for the MongoDB Local MCP Server. Current version: ${nodeVersion ?? "unknown"}. Please install or activate a compatible version.`
            )
        );
        printNewLine();
    }
};

const validatePlatform = (): Platform => {
    const platform = getPlatform();
    if (!platform) {
        console.log(chalk.red("Unsupported platform. Only macOS, Windows and Linux are supported."));
        printNewLine();
        process.exit(1);
    }
    return platform;
};

const validateDocker = async (): Promise<boolean> => {
    const client = await defaultCreateAtlasLocalClient({ logger: new NullLogger() });
    if (client) {
        try {
            // Use the client to confirm docker is available and running
            await client.listDeployments();
            return true;
        } catch {
            // Can't connect to docker daemon, treat as if docker isn't available and return false
        }
    }

    return false;
};

const printInstructions = (): void => {
    console.log("To install a Local MCP Server configuration, you will need at least ONE of the following:");
    console.log("1. A MongoDB connection string (requires a cluster or local MongoDB instance)");
    console.log("2. Your Atlas project's Service Account credentials\n");
    console.log(
        "It's best to have this information at hand. We will not store any data or credentials in this process."
    );
    printNewLine();
};
const promptForAITool = async (platform: Platform): Promise<AIToolType> => {
    return await select<AIToolType>({
        message: "What tool would you like to use the MongoDB MCP Server with?",
        choices: [
            { value: "cursor", name: "Cursor" },
            { value: "vscode", name: "VS Code" },
            // Claude Desktop is only supported on macOS and Windows
            ...(platform !== "linux" ? [{ value: "claudeDesktop" as const, name: "Claude Desktop" }] : []),
            { value: "claudeCode", name: "Claude Code" },
            { value: "opencode", name: "Open Code" },
            { value: "windsurf", name: "Windsurf" },
        ],
    });
};
const promptForReadonly = async (): Promise<boolean> => {
    return await confirm({ message: "Install MCP server as Read-only?", default: false });
};

const promptForConnectionString = async (config: UserConfig): Promise<string> => {
    console.log("Providing a connection string allows the MCP server to read and write data to your MongoDB cluster.");
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
            return connectionString;
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
        } catch (error: unknown) {
            // If auth type detection failed but user provided a connection string, preserve it
            return connectionString;
        }
    }
    return "";
};

const promptForServiceAccountId = async (): Promise<string> => {
    console.log("\nService Accounts allow the MCP Server to access Atlas tools and perform actions on your behalf.");
    return await input({ message: "Enter your Atlas Service Account Client ID (press enter to skip):" });
};

const promptForServiceAccountSecret = async (): Promise<string> => {
    return await password({ message: "Enter your Atlas Service Account Secret (press enter to skip):", mask: true });
};

const validateCredentials = (
    connectionString: string,
    serviceAccountId: string,
    serviceAccountSecret: string,
    hasDocker: boolean
): void => {
    // If either the connection string is missing or one of the service account credentials, throw error
    if (!connectionString && (!serviceAccountId || !serviceAccountSecret)) {
        console.log(
            chalk.yellow(
                "No credentials have been provided, so the MCP Server will not be able to access your MongoDB data or Atlas project."
            )
        );

        if (hasDocker) {
            console.log(
                chalk.yellow(
                    "Since you have Docker installed, you can still use the MCP server with a local Atlas instance running in a container."
                )
            );
        } else {
            console.log(
                chalk.red(
                    "Since you don't have Docker installed, you can only connect to a MongoDB instance dynamically, " +
                        chalk.bold(
                            chalk.red(
                                "which is strongly discouraged as it will expose your connection string to the LLM."
                            )
                        )
                )
            );
        }
        printNewLine();
    }
};

const getAvailablePrompts = (
    connectionString: string,
    serviceAccountId: string,
    serviceAccountSecret: string,
    hasDocker: boolean
): string[] => {
    const availablePrompts: string[] = [];
    if (connectionString) {
        availablePrompts.push('\t"List the collections in my MongoDB instance"');
        availablePrompts.push('\t"Show me some db stats about my Atlas cluster"');
    }

    if (serviceAccountId && serviceAccountSecret) {
        availablePrompts.push('\t"What are the clusters in my project?"');
        availablePrompts.push('\t"Does my project have any active alerts?"');
    }

    if (hasDocker) {
        availablePrompts.push('\t"Create a local Atlas deployment and connect to it"');
        availablePrompts.push('\t"How many databases are there in my local Atlas instance?"');
    }

    if (availablePrompts.length === 0) {
        availablePrompts.push(
            "\t[strongly discouraged] Connect to a MongoDB instance at mongodb://localhost:27017 and list the databases"
        );
    }

    return availablePrompts;
};

const promptToOpenConfigFile = async (displayName: string, tool: AIToolType): Promise<void> => {
    let openConfigMessage = `Would you like to open the config file in ${displayName}?`;
    if (TOOLS_WITHOUT_EDITORS.includes(tool)) {
        openConfigMessage = `Would you like to open the config file in your default editor?`;
    }
    const openConfig = await confirm({
        message: openConfigMessage,
        default: true,
    });

    if (openConfig) {
        try {
            await openConfigSettings(tool);
        } catch (error: unknown) {
            console.log(chalk.red(`Failed to open config file: ${formatError(error)}`));
        }
    }
};

const guideUserWithSetupSuccess = (displayName: string, availablePrompts: string[]): void => {
    printNewLine();
    console.log(
        chalk.green(
            `Setup complete! You can now use the MongoDB MCP Server in ${displayName}. You will probably need to restart your application to see the changes.\n`
        )
    );
    console.log("Try a query to get started:\n");
    console.log(availablePrompts.join("\n"));
    printNewLine();
};

export const runSetup = async (config: UserConfig): Promise<void> => {
    try {
        printLogo();
        validateNodeVersion();
        const platform = getPlatform();
        validatePlatform();
        printInstructions();

        const hasDocker = await validateDocker();

        const tool = await promptForAITool(platform as Platform);
        const displayName = AI_TOOL_REGISTRY[tool].name;
        printNewLine();

        const isReadOnly = await promptForReadonly();
        printNewLine();

        const connectionString = await promptForConnectionString(config);
        const serviceAccountId = await promptForServiceAccountId();
        const serviceAccountSecret = await promptForServiceAccountSecret();
        printNewLine();

        validateCredentials(connectionString, serviceAccountId, serviceAccountSecret, hasDocker);

        await configureEditor(tool, connectionString, serviceAccountId, serviceAccountSecret, isReadOnly);

        const availablePrompts = getAvailablePrompts(
            connectionString,
            serviceAccountId,
            serviceAccountSecret,
            hasDocker
        );
        guideUserWithSetupSuccess(displayName, availablePrompts);
        await promptToOpenConfigFile(displayName, tool);
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
