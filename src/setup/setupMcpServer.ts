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
import { NullLogger } from "../common/logging/index.js";
import type { TelemetryResult } from "../telemetry/types.js";
import { SetupTelemetry } from "./setupTelemetry.js";
import { Keychain } from "../common/keychain.js";

const keychain = new Keychain();

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

const testConnectionString = async (
    connectionString: string
): Promise<{
    connectionString: string;
    /** Final result of the connection attempt, or undefined if the user never tested. */
    testResult?: TelemetryResult;
    /** Number of connection attempts the user made (1 = initial attempt, 2+ = with retries). */
    attempts: number;
}> => {
    let attempts = 0;
    while (true) {
        attempts += 1;
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
            return { connectionString, testResult: "success", attempts };
        } catch (error: unknown) {
            console.log(chalk.red("\n✗ Connection failed: " + formatError(error, keychain)));
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
                return { connectionString, testResult: "failure", attempts };
            }
        } finally {
            try {
                await serviceProvider?.close();
            } catch {
                // Ignore close errors
            }
        }
    }
};

const configureEditor = async (
    tool: AIToolType,
    connectionString: string,
    serviceWorkerId: string,
    serviceWorkerSecret: string,
    isReadOnly: boolean
): Promise<{
    usedDefaultConfigPath: boolean;
    result: TelemetryResult;
    error?: unknown;
}> => {
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
    try {
        AI_TOOL_REGISTRY[tool].updateConfig(configPath, env, isReadOnly);
        console.log(`\nConfiguration saved to ${configPath}`);
        return { usedDefaultConfigPath: useDetectedPath, result: "success" };
    } catch (error: unknown) {
        console.log(chalk.red(`\nFailed to save configuration: ${formatError(error, keychain)}`));
        return { usedDefaultConfigPath: useDetectedPath, result: "failure", error };
    }
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

const validateNodeVersion = (): boolean => {
    const nodeVersion = process.versions.node;
    const requiredNodeRange = packageInfo.engines.node;
    if (!nodeVersion || !semver.satisfies(nodeVersion, requiredNodeRange)) {
        console.log(
            chalk.red(
                `Node version satisfying "${requiredNodeRange}" is required for the MongoDB Local MCP Server. Current version: ${nodeVersion ?? "unknown"}. Please install or activate a compatible version.`
            )
        );
        printNewLine();
        return false;
    }
    return true;
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

const promptForConnectionString = async (
    config: UserConfig
): Promise<{
    connectionString: string;
    provided: boolean;
    tested: boolean;
    attempts: number;
    testResult?: TelemetryResult;
}> => {
    console.log("Providing a connection string allows the MCP server to read and write data to your MongoDB cluster.");
    const connectionString = await password({
        message: "Enter your MongoDB connection string (press enter to skip):",
        mask: true,
    });

    if (!connectionString) {
        return { connectionString: "", provided: false, tested: false, attempts: 0 };
    }

    keychain.register(connectionString, "mongodb uri");

    try {
        const auth = getAuthType(config, connectionString);
        if (auth === "scram") {
            const shouldTest = await confirm({ message: "Test your connection string?", default: true });

            if (shouldTest) {
                const outcome = await testConnectionString(connectionString);
                return {
                    connectionString: outcome.connectionString,
                    provided: true,
                    tested: true,
                    attempts: outcome.attempts,
                    testResult: outcome.testResult,
                };
            }
        }
        return { connectionString, provided: true, tested: false, attempts: 0 };
    } catch {
        // If auth type detection failed but user provided a connection string, preserve it
        return { connectionString, provided: true, tested: false, attempts: 0 };
    }
};

const promptForServiceAccountId = async (): Promise<string> => {
    console.log("\nService Accounts allow the MCP Server to access Atlas tools and perform actions on your behalf.");
    return await input({ message: "Enter your Atlas Service Account Client ID (press enter to skip):" });
};

const promptForServiceAccountSecret = async (): Promise<string> => {
    const secret = await password({
        message: "Enter your Atlas Service Account Secret (press enter to skip):",
        mask: true,
    });
    keychain.register(secret, "private key");
    return secret;
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
                    "Since you have Docker running, you can still use the MCP server with a local Atlas instance running in a container."
                )
            );
        } else {
            console.log(
                chalk.red(
                    "Since you don't have Docker running, you can only connect to a MongoDB instance dynamically, " +
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

const promptToOpenConfigFile = async (
    displayName: string,
    tool: AIToolType
): Promise<{
    opened: boolean;
    result: TelemetryResult;
    error?: unknown;
}> => {
    let openConfigMessage = `Would you like to open the config file in ${displayName}?`;
    if (TOOLS_WITHOUT_EDITORS.includes(tool)) {
        openConfigMessage = `Would you like to open the config file in your default editor?`;
    }
    const openConfig = await confirm({
        message: openConfigMessage,
        default: true,
    });

    if (!openConfig) {
        return { opened: false, result: "success" };
    }

    try {
        await openConfigSettings(tool);
        return { opened: true, result: "success" };
    } catch (error: unknown) {
        console.log(chalk.red(`Failed to open config file: ${formatError(error, keychain)}`));
        return { opened: true, result: "failure", error };
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

/**
 * Runs the interactive setup wizard. When `setupTelemetry` is provided, each
 * logical step emits a telemetry event so we can track both overall completion
 * rates and per-step drop-off.
 */
export const runSetup = async (config: UserConfig): Promise<never> => {
    const setupTelemetry = SetupTelemetry.create(config, keychain);

    // Ensure hard cancellations (SIGINT/SIGTERM outside of an Inquirer prompt)
    // are still captured. Inquirer itself converts Ctrl+C during prompts into
    // an ExitPromptError which runSetup already handles.
    let interrupted = false;
    const onInterrupt = (): void => {
        if (interrupted) {
            return;
        }

        interrupted = true;
        setupTelemetry.emitCancelled();
        setupTelemetry
            .flush()
            .catch(() => undefined)
            .finally(() => process.exit(0));
    };
    process.on("SIGINT", onInterrupt);
    process.on("SIGTERM", onInterrupt);

    let exitCode = 0;

    try {
        printLogo();
        setupTelemetry.emitStarted();

        const nodeVersionOk = validateNodeVersion();
        const platform = getPlatform();
        const platformSupported = platform !== null;
        if (!platformSupported) {
            console.log(chalk.red("Unsupported platform. Only macOS, Windows and Linux are supported."));
            printNewLine();
            setupTelemetry.emitPrerequisitesChecked({
                nodeVersionOk,
                platformSupported: false,
            });
            setupTelemetry.emitFailed(new Error("unsupported_platform"));
            process.exit(1);
        }

        printInstructions();

        const hasDocker = await validateDocker();
        setupTelemetry.emitPrerequisitesChecked({ nodeVersionOk, platformSupported, hasDocker });

        const tool = await promptForAITool(platform);
        const displayName = AI_TOOL_REGISTRY[tool].name;
        setupTelemetry.emitAiToolSelected(tool);
        printNewLine();

        const isReadOnly = await promptForReadonly();
        setupTelemetry.emitReadOnlySelected(isReadOnly);
        printNewLine();

        const connectionOutcome = await promptForConnectionString(config);
        setupTelemetry.emitConnectionStringEntered({
            provided: connectionOutcome.provided,
            tested: connectionOutcome.tested,
            attempts: connectionOutcome.attempts,
            testResult: connectionOutcome.testResult,
        });

        const serviceAccountId = await promptForServiceAccountId();
        setupTelemetry.emitServiceAccountIdEntered(Boolean(serviceAccountId));

        const serviceAccountSecret = await promptForServiceAccountSecret();
        setupTelemetry.emitServiceAccountSecretEntered(Boolean(serviceAccountSecret));
        printNewLine();

        validateCredentials(connectionOutcome.connectionString, serviceAccountId, serviceAccountSecret, hasDocker);
        setupTelemetry.emitCredentialsValidated();

        const editorOutcome = await configureEditor(
            tool,
            connectionOutcome.connectionString,
            serviceAccountId,
            serviceAccountSecret,
            isReadOnly
        );
        setupTelemetry.emitEditorConfigured(editorOutcome);

        const availablePrompts = getAvailablePrompts(
            connectionOutcome.connectionString,
            serviceAccountId,
            serviceAccountSecret,
            hasDocker
        );
        guideUserWithSetupSuccess(displayName, availablePrompts);
        const openOutcome = await promptToOpenConfigFile(displayName, tool);
        setupTelemetry.emitOpenConfigPrompted(openOutcome);

        setupTelemetry.emitCompleted();
    } catch (error: unknown) {
        // Handle Ctrl+C during prompts (inquirer throws ExitPromptError)
        // Re-throw other errors
        if (error && typeof error === "object" && "name" in error && error.name === "ExitPromptError") {
            console.log("\n\nSetup cancelled. Goodbye!");
            setupTelemetry.emitCancelled();
        } else {
            exitCode = 1;
            setupTelemetry.emitFailed(error);

            console.error(`Setup failed: ${error instanceof Error ? error.message : String(error)}`);
        }
    } finally {
        process.off("SIGINT", onInterrupt);
        process.off("SIGTERM", onInterrupt);
        await setupTelemetry.flush();
    }

    process.exit(exitCode);
};
