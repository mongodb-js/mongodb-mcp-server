import { parseUserConfig } from "./config/parseUserConfig.js";
import { createServicesFromUserConfig } from "./createServicesFromUserConfig.js";
import { startServer } from "./startServer.js";
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
 * import { AllTools } from "mongodb-mcp-server";
 * import { Resources } from "./resources/resources.js";
 *
 * await runMcpCli({
 *   args: process.argv.slice(2),
 *   serverMetadata,
 *   consoleLogger: console,
 *   onExit: (code) => process.exit(code),
 *   tools: AllTools,
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

    // Create server and infrastructure
    const { server, logger, metrics } = await createServicesFromUserConfig({
        config,
        serverMetadata,
        tools,
        resources,
    });

    // Start the server (stdio or HTTP based on config)
    await startServer(server, config, logger, metrics, onExit);
}
