import { startServer } from "./startServer.js";
import type { CLIOptions } from "./types.js";

/**
 * Run the MCP CLI with the given configuration.
 * Handles full CLI flow: checking handlers, flags, and server lifecycle.
 *
 * This function assumes you've already created the infrastructure using
 * `createServerFromUserConfig` and created your server. It handles:
 * - Checking custom handlers
 * - Handling --help, --version, --dryRun flags
 * - Starting the server with proper signal handling
 *
 * Example usage:
 * ```typescript
 * import { createServerFromUserConfig, runMcpCli } from "@mongodb-js/mcp-cli";
 *
 * // Create infrastructure (config, logger, metrics)
 * const { config, logger, metrics } = await createServerFromUserConfig({
 *   args: process.argv.slice(2),
 *   consoleLogger: console,
 * });
 *
 * // Create your server
 * const server = new MyServer({ config, logger, metrics });
 *
 * // Run the CLI
 * await runMcpCli({
 *   args: process.argv.slice(2),
 *   consoleLogger: console,
 *   onExit: (code) => process.exit(code),
 *   clientInfo: { name: "my-mcp-server", version: "1.0.0" },
 *   server,
 *   config,
 *   logger,
 *   metrics,
 * });
 * ```
 */
export async function runMcpCli(options: CLIOptions): Promise<void> {
    const { args, consoleLogger, onExit, clientInfo, handlers, server, config, logger, metrics } = options;

    // Check custom handlers first
    if (handlers) {
        for (const handler of handlers) {
            if (handler.shouldHandle(config, args)) {
                await handler.handle(config, consoleLogger, onExit);
                return;
            }
        }
    }

    // Handle --help
    if (config.help) {
        consoleLogger.log("For usage information refer to the README.md:");
        consoleLogger.log("https://github.com/mongodb-js/mongodb-mcp-server?tab=readme-ov-file#quick-start");
        onExit(0);
        return;
    }

    // Handle --version
    if (config.version) {
        consoleLogger.log(clientInfo.version);
        onExit(0);
        return;
    }

    // Handle --dryRun
    if (config.dryRun) {
        consoleLogger.log("Configuration:");
        consoleLogger.log(JSON.stringify(config, null, 2));
        consoleLogger.log("\nDry run mode - exiting without starting server.");
        onExit(0);
        return;
    }

    // Start the server (stdio or HTTP based on config)
    await startServer(server, config, logger, metrics, onExit);
}

// Re-export Handler type for convenience
export type { Handler } from "./types.js";
