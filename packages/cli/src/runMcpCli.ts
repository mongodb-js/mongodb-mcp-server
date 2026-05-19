import { startServer } from "./startServer.js";
import type { CompositeLogger } from "@mongodb-js/mcp-core";
import type { ConsoleLogger, OnExit, Handler, StartableServer } from "./types.js";
import type { UserConfig } from "./config/userConfig.js";
import type { ServerMetadata, IMetrics, DefaultMetricDefinitions } from "@mongodb-js/mcp-types";

/**
 * Run the MCP CLI with the given configuration.
 * Handles full CLI flow: checking handlers, flags, and server lifecycle.
 *
 * This function assumes you've already created the infrastructure using
 * `createServicesFromUserConfig` and created your server. It handles:
 * - Checking custom handlers
 * - Handling --help, --version, --dryRun flags
 * - Starting the server with proper signal handling
 *
 * Example usage:
 * ```typescript
 * import { createServicesFromUserConfig, runMcpCli } from "@mongodb-js/mcp-cli";
 *
 * // Create infrastructure (config, logger, metrics)
 * const { server, config, logger, metrics } = await createServicesFromUserConfig({
 *   args: process.argv.slice(2),
 *   consoleLogger: console,
 *   serverMetadata,
 *   tools: AllTools,
 *   resources: Resources,
 * });
 *
 * // Run the CLI
 * await runMcpCli({
 *   args: process.argv.slice(2),
 *   serverMetadata,
 *   server,
 *   config,
 *   logger,
 *   metrics,
 *   consoleLogger: console,
 *   onExit: (code) => process.exit(code),
 * });
 * ```
 */
export async function runMcpCli({
    args,
    serverMetadata,
    handlers,
    server,
    config,
    logger,
    metrics,
    consoleLogger,
    onExit,
}: {
    args: string[];
    serverMetadata: ServerMetadata;
    handlers?: Handler[];
    server: StartableServer;
    config: UserConfig;
    logger: CompositeLogger;
    metrics: IMetrics<DefaultMetricDefinitions>;
    consoleLogger: ConsoleLogger;
    onExit: OnExit;
}): Promise<void> {
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
        consoleLogger.log(serverMetadata.version);
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
