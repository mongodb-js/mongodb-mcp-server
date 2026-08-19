import { PrometheusMetrics, createDefaultMetrics } from "@mongodb-js/mcp-metrics";
import {
    SharedSessionServerMCPHttpServer,
    StreamableHttpRunner,
    type MonitoringServer,
} from "@mongodb-js/mcp-http-runners";
import type { IMetrics } from "@mongodb-js/mcp-types";
import type { CompositeLogger } from "@mongodb-js/mcp-core";
import { Elicitation, Keychain, McpServer, SessionStore, StdioRunner, getRandomUUID } from "@mongodb-js/mcp-core";
import type { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { ResourceRegistry, ToolRegistry } from "./cliServer.js";
import { CliServer } from "./cliServer.js";
import { connectionErrorHandler, DeviceId, MCPConnectionStore } from "@mongodb-js/mcp-tools-mongodb";
import { createAtlasLocalClient } from "@mongodb-js/mcp-tools-atlas-local";
import { Session } from "./cliSession.js";
import type { UserConfig } from "./config/userConfig.js";
import type { ServerMetadata } from "@mongodb-js/mcp-types";
import { createExportsManagerFromConfig } from "./createExportsManagerFromConfig.js";
import { createApiClientFromConfig } from "./createApiClientFromConfig.js";
import { createTelemetryFromConfig } from "./createTelemetryFromConfig.js";
import { createMonitoringServerFromConfig } from "./createMonitoringServerFromConfig.js";

export type CreateServerFromConfigOptions = {
    config: UserConfig;
    serverMetadata: ServerMetadata;
    tools: ToolRegistry;
    resources: ResourceRegistry;
    logger: CompositeLogger;
};

export type ServerFromConfigServices = {
    server: CliServer;
    config: UserConfig;
    metrics: IMetrics;
    monitoringServer: MonitoringServer | undefined;
};

/**
 * Creates the server and the shared infrastructure it depends on.
 */
export async function createServerFromConfig({
    config,
    serverMetadata,
    tools,
    resources,
    logger,
}: CreateServerFromConfigOptions): Promise<ServerFromConfigServices> {
    const metrics = new PrometheusMetrics({ definitions: createDefaultMetrics() });
    const monitoringServer = createMonitoringServerFromConfig({ config, logger, metrics });

    const keychain = Keychain.root;
    const exportsManager = createExportsManagerFromConfig({ config, logger });
    const deviceId = DeviceId.create(logger);

    const connectionStore = new MCPConnectionStore({ options: config, logger, deviceId });
    // Each server instance owns its connection scope: sessions are scoped to
    // the session by default, or shared globally when configured so.
    const connectionRegistry = connectionStore.view({
        scope: config.connectionScope === "session" ? getRandomUUID() : undefined,
        owned: true,
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

    const elicitation = new Elicitation({
        server: mcpServer.server,
        timeoutMs: config.elicitationTimeoutMs,
    });

    const session = new Session({
        logger,
        exportsManager,
        connectionRegistry,
        keychain,
        apiClient,
        connectionErrorHandler,
        atlasLocalClient,
        config,
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

    return { server, config, metrics, monitoringServer };
}

export type CreateRunnerFromConfigOptions = CreateServerFromConfigOptions;

/**
 * Creates the server (via {@link createServerFromConfig}) and returns the
 * transport runner wired for the configured transport (stdio or http).
 */
export async function createRunnerFromConfig(
    options: CreateRunnerFromConfigOptions
): Promise<StdioRunner | StreamableHttpRunner> {
    const { config, logger } = options;
    const { server, metrics, monitoringServer } = await createServerFromConfig(options);

    if (config.transport === "stdio") {
        return new StdioRunner({ logger, server });
    }
    return createHttpTransportRunnerFromConfig({ config, server, logger, metrics, monitoringServer });
}

/**
 * Creates the HTTP transport runner (shared-session HTTP server plus
 * streamable HTTP transport) from the config and shared services.
 */
export function createHttpTransportRunnerFromConfig({
    config,
    server,
    logger,
    metrics,
    monitoringServer,
}: {
    config: UserConfig;
    server: CliServer;
    logger: CompositeLogger;
    metrics: IMetrics;
    monitoringServer: MonitoringServer | undefined;
}): StreamableHttpRunner {
    const sessionStore = new SessionStore<StreamableHTTPServerTransport>({
        options: {
            idleTimeoutMS: config.idleTimeoutMs,
            notificationTimeoutMS: config.notificationTimeoutMs,
            maxSessions: config.maxSessions,
        },
        logger,
        metrics,
    });

    const mcpHttpServer = new SharedSessionServerMCPHttpServer({
        server,
        options: {
            http: {
                host: config.httpHost,
                port: config.httpPort,
                responseType: config.httpResponseType,
                headers: config.httpHeaders,
            },
            session: {
                externallyManagedSessions: config.externallyManagedSessions,
                idleTimeoutMs: config.idleTimeoutMs,
                notificationTimeoutMs: config.notificationTimeoutMs,
            },
        },
        logger,
        metrics,
        sessionStore,
    });

    return new StreamableHttpRunner({
        logger,
        mcpHttpServer,
        monitoringServer,
    });
}
