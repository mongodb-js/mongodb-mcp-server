import { PrometheusMetrics, createDefaultMetrics } from "@mongodb-js/mcp-metrics";
import type { IMetrics } from "@mongodb-js/mcp-types";
import type { CompositeLogger } from "@mongodb-js/mcp-core";
import { Elicitation, Keychain, McpServer } from "@mongodb-js/mcp-core";
import { createDefaultLoggers } from "./utils/loggers.js";
import type { ResourceRegistry, ToolRegistry } from "./cliServer.js";
import { CliServer } from "./cliServer.js";
import { ApiClient, ClientCredentialsAuthProvider } from "@mongodb-js/mcp-atlas-api-client";
import { connectionErrorHandler, DeviceId, ExportsManager, MCPConnectionManager } from "@mongodb-js/mcp-tools-mongodb";
import { AtlasTelemetry } from "@mongodb-js/mcp-atlas-telemetry";
import { createAtlasLocalClient } from "@mongodb-js/mcp-tools-atlas-local";
import { CliSession } from "./cliSession.js";
import type { UserConfig } from "./config/userConfig.js";
import type { ServerMetadata } from "@mongodb-js/mcp-types";

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
        serverMetadata,
        connectionInfo: { transport: "http", httpHost: "localhost" },
    });

    const userAgent = `${serverMetadata.mcpServerName}/${serverMetadata.version}`;
    const apiClient = new ApiClient({
        options: {
            baseUrl: config.apiBaseUrl,
            userAgent,
        },
        logger,
        authProvider:
            config.apiClientId && config.apiClientSecret
                ? new ClientCredentialsAuthProvider({
                      options: {
                          baseUrl: config.apiBaseUrl,
                          userAgent,
                          clientId: config.apiClientId,
                          clientSecret: config.apiClientSecret,
                      },
                      logger,
                  })
                : undefined,
    });

    const atlasLocalClient = await createAtlasLocalClient({ logger });

    const telemetry = AtlasTelemetry.create({
        logger,
        deviceId,
        apiClient,
        keychain,
        enabled: config.telemetry === "enabled",
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
