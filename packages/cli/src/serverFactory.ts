import { PrometheusMetrics, createDefaultMetrics } from "@mongodb-js/mcp-metrics";
import { createDefaultLoggers } from "./utils/loggers.js";
import { parseUserConfig } from "./config/parseUserConfig.js";
import type { ConsoleLogger } from "./types.js";
import type { UserConfig } from "./config/userConfig.js";
import { connectionErrorHandler } from "@mongodb-js/mcp-tools-mongodb";

export type ServerInfrastructure = {
    config: UserConfig;
    logger: Awaited<ReturnType<typeof createDefaultLoggers>>;
    metrics: PrometheusMetrics<ReturnType<typeof createDefaultMetrics>>;
};

/**
 * Parses CLI arguments and creates the shared infrastructure (config, logger, metrics)
 * needed to run an MCP server. Use this as the starting point when building a server,
 * then create your server with the returned values and pass everything to `runMcpCli`.
 */
export async function createServerFromUserConfig(options: {
    args: string[];
    consoleLogger: ConsoleLogger;
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

    const keychain = CoreKeychain.root;

    const exportsManager = ExportsManager.init({
        options: {
            exportsPath: config.exportsPath,
            exportTimeoutMs: config.exportTimeoutMs,
            exportCleanupIntervalMs: config.exportCleanupIntervalMs,
        },
        logger,
    });

    const deviceId = DeviceId.create(logger);

    const connectionManager = new MCPConnectionManager({
        logger,
        deviceId,
        options: {
            connectionInfo: { transport: "http", httpHost: "localhost" },
            displayName: "mongodb-mcp-server",
            version: packageInfo.version,
        },
    });

    const apiClient = new ApiClient({
        baseUrl: config.apiBaseUrl,
        userAgent: `mongodb-mcp-server/${packageInfo.version}`,
        logger,
        credentials: {
            clientId: config.apiClientId,
            clientSecret: config.apiClientSecret,
        },
    });

    const atlasLocalClient = await createAtlasLocalClient({ logger });

    const telemetry = AtlasTelemetry.create({
        logger,
        deviceId,
        apiClient,
        keychain,
        enabled: config.telemetry === "enabled",
        machineMetadata: buildMachineMetadata(packageInfo.mcpServerName, packageInfo.version),
    });

    const mcpServer = new McpServer({
        name: "mongodb-mcp-server",
        version: packageInfo.version,
    });

    const elicitation = new Elicitation({ server: mcpServer.server });

    const session = new Session({
        userConfig: config,
        logger,
        exportsManager,
        connectionManager,
        keychain,
        apiClient,
        connectionErrorHandler,
        atlasLocalClient,
    });

    const server = new Server({
        session,
        userConfig: config,
        mcpServer,
        telemetry,
        connectionErrorHandler,
        elicitation,
        metrics,
    });

    return { config, logger, metrics };
}
