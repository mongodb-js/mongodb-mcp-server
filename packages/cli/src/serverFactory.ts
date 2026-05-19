import { type IMetrics, PrometheusMetrics, createDefaultMetrics } from "@mongodb-js/mcp-metrics";
import type { CompositeLogger } from "@mongodb-js/mcp-core";
import { Elicitation, Keychain, McpServer } from "@mongodb-js/mcp-core";
import { createDefaultLoggers } from "./utils/loggers.js";
import { parseUserConfig } from "./config/parseUserConfig.js";
import type { ConsoleLogger } from "./types.js";
import type { ResourceRegistry, ToolRegistry } from "./server.js";
import { Server } from "./server.js";
import { ApiClient } from "@mongodb-js/mcp-atlas-api-client";
import { connectionErrorHandler, DeviceId, ExportsManager, MCPConnectionManager } from "@mongodb-js/mcp-tools-mongodb";
import { AtlasTelemetry, buildMachineMetadata } from "@mongodb-js/mcp-atlas-telemetry";
import { createAtlasLocalClient } from "@mongodb-js/mcp-tools-atlas-local";
import { Session } from "./session.js";
import type { UserConfig } from "./config/userConfig.js";
import type { ServerMetadata } from "@mongodb-js/mcp-types";

/**
 * Parses CLI arguments and creates the shared infrastructure (config, logger, metrics, keychain)
 * needed to run an MCP server. Use this as the starting point when building a server,
 * then create your server with the returned values and pass everything to `runMcpCli`.
 */
export async function createServicesFromUserConfig({
    args,
    consoleLogger,
    serverMetadata,
    tools,
    resources,
}: {
    args: string[];
    consoleLogger: ConsoleLogger;
    serverMetadata: ServerMetadata;
    tools: ToolRegistry;
    resources: ResourceRegistry;
}): Promise<{ server: Server; config: UserConfig; logger: CompositeLogger; metrics: IMetrics }> {
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
    const keychain = Keychain.root;
    const logger = await createDefaultLoggers({ config, keychain });
    const metrics = new PrometheusMetrics({ definitions: createDefaultMetrics() });

    // Create MongoDB-specific infrastructure
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
            version: serverMetadata.version,
        },
    });

    const apiClient = new ApiClient({
        baseUrl: config.apiBaseUrl,
        userAgent: `mongodb-mcp-server/${serverMetadata.version}`,
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
        machineMetadata: buildMachineMetadata(serverMetadata),
    });

    const mcpServer = new McpServer({
        name: "mongodb-mcp-server",
        version: serverMetadata.version,
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
        serverMetadata,
        tools,
        resources,
    });

    return { server, config, logger, metrics };
}
