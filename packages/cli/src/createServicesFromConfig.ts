import { PrometheusMetrics, createDefaultMetrics } from "@mongodb-js/mcp-metrics";
import type { MonitoringServer } from "@mongodb-js/mcp-http-runners";
import type { IMetrics } from "@mongodb-js/mcp-types";
import type { CompositeLogger } from "@mongodb-js/mcp-core";
import { Elicitation, Keychain, McpServer } from "@mongodb-js/mcp-core";
import type { ResourceRegistry, ToolRegistry } from "./cliServer.js";
import { CliServer } from "./cliServer.js";
import { connectionErrorHandler, DeviceId, MCPConnectionManager } from "@mongodb-js/mcp-tools-mongodb";
import { createAtlasLocalClient } from "@mongodb-js/mcp-tools-atlas-local";
import { CliSession } from "./cliSession.js";
import type { UserConfig } from "./config/userConfig.js";
import type { ServerMetadata } from "@mongodb-js/mcp-types";
import { createLoggerFromConfig } from "./createLoggerFromConfig.js";
import { createExportsManagerFromConfig } from "./createExportsManagerFromConfig.js";
import { createApiClientFromConfig } from "./createApiClientFromConfig.js";
import { createTelemetryFromConfig } from "./createTelemetryFromConfig.js";
import { createMonitoringServerFromConfig } from "./createMonitoringServerFromConfig.js";

export type CreateServicesFromConfigOptions = {
    config: UserConfig;
    serverMetadata: ServerMetadata;
    tools: ToolRegistry;
    resources: ResourceRegistry;
};

/**
 * Creates the shared infrastructure with common defaults.
 */
export async function createServicesFromConfig({
    config,
    serverMetadata,
    tools,
    resources,
}: CreateServicesFromConfigOptions): Promise<{
    server: CliServer;
    config: UserConfig;
    logger: CompositeLogger;
    metrics: IMetrics;
    monitoringServer: MonitoringServer | undefined;
}> {
    const keychain = Keychain.root;
    const logger = await createLoggerFromConfig({ config, keychain });
    const metrics = new PrometheusMetrics({ definitions: createDefaultMetrics() });
    const monitoringServer = createMonitoringServerFromConfig({ config, logger, metrics });

    const exportsManager = createExportsManagerFromConfig({ config, logger });
    const deviceId = DeviceId.create(logger);

    const connectionManager = new MCPConnectionManager({
        logger,
        deviceId,
        serverMetadata,
        connectionInfo: { transport: "http", httpHost: "localhost" },
    });

    const apiClient = createApiClientFromConfig({ config, serverMetadata, logger });
    const atlasLocalClient = await createAtlasLocalClient({ logger });

    const telemetry = createTelemetryFromConfig({
        config,
        logger,
        deviceId,
        apiClient,
        keychain,
        serverMetadata,
    });

    const mcpServer = new McpServer({
        name: serverMetadata.mcpServerName,
        version: serverMetadata.version,
    });

    const elicitation = new Elicitation({ server: mcpServer.server });

    const session = new CliSession({
        userConfig: config,
        logger,
        exportsManager,
        connectionManager,
        keychain,
        apiClient,
        connectionErrorHandler,
        atlasLocalClient,
    });

    const server = new CliServer({
        session,
        mcpServer,
        telemetry,
        connectionErrorHandler,
        elicitation,
        metrics,
        tools,
        resources,
        serverMetadata,
    });

    return { server, config, logger, metrics, monitoringServer };
}
