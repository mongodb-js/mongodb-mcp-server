import { PrometheusMetrics, createDefaultMetrics } from "@mongodb-js/mcp-metrics";
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

export type CreateServicesOptions = {
    config: UserConfig;
    serverMetadata: ServerMetadata;
    tools: ToolRegistry;
    resources: ResourceRegistry;
};

/**
 * Creates the shared infrastructure with common defaults.
 */
export async function createServicesFromUserConfig({
    config,
    serverMetadata,
    tools,
    resources,
}: CreateServicesOptions): Promise<{
    server: CliServer;
    config: UserConfig;
    logger: CompositeLogger;
    metrics: IMetrics;
}> {
    const keychain = Keychain.root;
    const logger = await createLoggerFromConfig({ config, keychain });
    const metrics = new PrometheusMetrics({ definitions: createDefaultMetrics() });

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

    return { server, config, logger, metrics };
}
