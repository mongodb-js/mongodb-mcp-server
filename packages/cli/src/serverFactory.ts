import { PrometheusMetrics, createDefaultMetrics } from "@mongodb-js/mcp-metrics";
import { Keychain } from "@mongodb-js/mcp-core";
import { createDefaultLoggers } from "./utils/loggers.js";
import { parseUserConfig } from "./config/parseUserConfig.js";
import type { ConsoleLogger } from "./types.js";
import type { UserConfig } from "./config/userConfig.js";

export type ServerInfrastructure = {
    config: UserConfig;
    logger: Awaited<ReturnType<typeof createDefaultLoggers>>;
    metrics: PrometheusMetrics<ReturnType<typeof createDefaultMetrics>>;
    keychain: Keychain;
};

/** Package information required for server creation. */
export type PackageInfo = {
    version: string;
    mcpServerName: string;
    engines: { node: string };
};

/**
 * Parses CLI arguments and creates the shared infrastructure (config, logger, metrics, keychain)
 * needed to run an MCP server. Use this as the starting point when building a server,
 * then create your server with the returned values and pass everything to `runMcpCli`.
 */
export async function createServerFromUserConfig(options: {
    args: string[];
    consoleLogger: ConsoleLogger;
    packageInfo: PackageInfo;
}): Promise<ServerInfrastructure> {
    const { args, consoleLogger } = options;

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

    // Create logger and metrics
    const logger = await createDefaultLoggers(config);
    const metrics = new PrometheusMetrics({ definitions: createDefaultMetrics() });
    const keychain = Keychain.root;

    return { config, logger, metrics, keychain };
}
