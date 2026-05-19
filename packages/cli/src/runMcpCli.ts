import type { IMetrics } from "@mongodb-js/mcp-metrics";
import { PrometheusMetrics, createDefaultMetrics } from "@mongodb-js/mcp-metrics";
import type { CompositeLogger } from "@mongodb-js/mcp-core";
import { Elicitation, Keychain, McpServer } from "@mongodb-js/mcp-core";
import { createDefaultLoggers } from "./utils/loggers.js";
import { parseUserConfig } from "./config/parseUserConfig.js";
import { startServer } from "./startServer.js";
import type { ConsoleLogger, OnExit } from "./types.js";
import type { CliHandler } from "./cliHandler.js";
import type { UserConfig } from "./config/userConfig.js";
import type { ServerMetadata } from "@mongodb-js/mcp-types";
import type { ResourceRegistry, ToolRegistry } from "./server.js";
import { Server } from "./server.js";
import { ApiClient } from "@mongodb-js/mcp-atlas-api-client";
import { connectionErrorHandler, DeviceId, ExportsManager, MCPConnectionManager } from "@mongodb-js/mcp-tools-mongodb";
import { AtlasTelemetry, buildMachineMetadata } from "@mongodb-js/mcp-atlas-telemetry";
import { createAtlasLocalClient } from "@mongodb-js/mcp-tools-atlas-local";
import { Session } from "./session.js";

export type RunMcpCliOptions = {
    args: string[];
    serverMetadata: ServerMetadata;
    consoleLogger: ConsoleLogger;
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
 * import { AllTools } from "./tools/index.js";
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
export async function createServerFromConfig({
    config,
    serverMetadata,
    tools,
    resources,
}: {
    config: UserConfig;
    serverMetadata: ServerMetadata;
    tools: ToolRegistry;
    resources: ResourceRegistry;
}): Promise<{ server: Server; logger: CompositeLogger; metrics: IMetrics }> {
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
            displayName: serverMetadata.mcpServerName,
            version: serverMetadata.version,
        },
    });

    const apiClient = new ApiClient({
        baseUrl: config.apiBaseUrl,
        userAgent: `${serverMetadata.mcpServerName}/${serverMetadata.version}`,
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
        name: serverMetadata.mcpServerName,
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
        tools,
        resources,
        serverMetadata,
    });

    return { server, logger, metrics };
}

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
    const { server, logger, metrics } = await createServerFromConfig({
        config,
        serverMetadata,
        tools,
        resources,
    });

    // Start the server (stdio or HTTP based on config)
    await startServer(server, config, logger, metrics, onExit);
}
