import { Keychain } from "@mongodb-js/mcp-core";
import { parseUserConfig } from "./config/parseUserConfig.js";
import { createLoggerFromConfig } from "./createLoggerFromConfig.js";
import { createRunnerFromConfig } from "./createRunnerFromConfig.js";
import { startRunner } from "./startRunner.js";
import type { CliHandler } from "./cliHandler.js";
import type { ServerMetadata } from "@mongodb-js/mcp-types";
import type { ResourceRegistry, ToolRegistry } from "./cliServer.js";
import type { OnExit, Console } from "./types.js";

export type RunMcpCliOptions = {
    args: string[];
    serverMetadata: ServerMetadata;
    consoleLogger: Console;
    onExit: OnExit;
    tools: ToolRegistry;
    resources: ResourceRegistry;
    handlers?: CliHandler[];
};

/**
 * Run the MCP CLI with the given configuration.
 * Handles full CLI flow: parsing config, creating infrastructure, checking handlers,
 * handling flags, and managing server lifecycle.
 *
 * This function creates all necessary infrastructure (config, logger, metrics, server)
 * and runs the CLI in one step.
 *
 * Example usage:
 * ```typescript
 * import { runMcpCli, DryRunHandler } from "@mongodb-js/mcp-cli";
 * import { MongoDBTools } from "@mongodb-js/mcp-tools-mongodb";
 * import { Resources } from "@mongodb-js/mcp-cli";
 *
 * await runMcpCli({
 *   args: process.argv.slice(2),
 *   serverMetadata,
 *   consoleLogger: console,
 *   onExit: (code) => process.exit(code),
 *   tools: [...MongoDBTools, MyCustomTool],
 *   resources: Resources,
 *   handlers: [new DryRunHandler()],
 * });
 * ```
 */
export async function runMcpCli({
    args,
    serverMetadata,
    consoleLogger,
    onExit,
    tools,
    resources,
    handlers,
}: RunMcpCliOptions): Promise<void> {
    // Parse CLI arguments
    const { error, warnings, parsed: config } = parseUserConfig({ args });

    // Handle parse errors
    if (!config || (error && error.length)) {
        consoleLogger.error(`${error}
- Refer to https://www.mongodb.com/docs/mcp-server/get-started/ for setting up the MCP Server.`);
        throw new Error(`Failed to parse config: ${error}`);
    }

    // Print warnings
    if (warnings && warnings.length > 0) {
        consoleLogger.warn(`${warnings.join("\n")}
- Refer to https://www.mongodb.com/docs/mcp-server/get-started/ for setting up the MCP Server.`);
    }

    if (handlers) {
        for (const handler of handlers) {
            const handled = await handler.handle({
                config,
                args,
                consoleLogger,
                onExit,
                serverMetadata,
            });
            if (handled) {
                return;
            }
        }
    }

    // Create logger, then the transport runner (stdio or HTTP based on config)
    const logger = await createLoggerFromConfig({ config, keychain: Keychain.root });

    try {
        const transportRunner = await createRunnerFromConfig({
            config,
            serverMetadata,
            tools,
            resources,
            logger,
        });

        // Start the transport runner
        await startRunner({ transportRunner, logger, onExit });
    } catch (error) {
        // Flush buffered logs (e.g. async disk writes) before the error reaches the
        // caller, which exits the process without waiting for pending log writes.
        await logger.flush();
        throw error;
    }
}
