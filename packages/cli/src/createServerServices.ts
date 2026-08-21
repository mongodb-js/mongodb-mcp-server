import { PrometheusMetrics, createDefaultMetrics } from "@mongodb-js/mcp-metrics";
import { CompositeLogger, Elicitation, Keychain, McpServer, getRandomUUID } from "@mongodb-js/mcp-core";
import type { IMetrics, IDeviceId } from "@mongodb-js/mcp-types";
import type { Client as AtlasLocalClient } from "@mongodb-js/atlas-local";
import type { ResourceRegistry, ToolRegistry } from "./cliServer.js";
import { CliServer } from "./cliServer.js";
import {
    connectionErrorHandler,
    DeviceId,
    MCPConnectionStore,
    type ConnectionRegistry,
} from "@mongodb-js/mcp-tools-mongodb";
import { createAtlasLocalClient } from "@mongodb-js/mcp-tools-atlas-local";
import { Session } from "./cliSession.js";
import type { UserConfig } from "./config/userConfig.js";
import type { ServerMetadata } from "@mongodb-js/mcp-types";
import { createExportsManagerFromConfig } from "./createExportsManagerFromConfig.js";
import { createApiClientFromConfig } from "./createApiClientFromConfig.js";
import { createTelemetryFromConfig } from "./createTelemetryFromConfig.js";
import { createMonitoringServerFromConfig } from "./createMonitoringServerFromConfig.js";

export type CreateServerServicesOptions = {
    config: UserConfig;
    serverMetadata: ServerMetadata;
    tools: ToolRegistry;
    resources: ResourceRegistry;
    logger: CompositeLogger;
};

/** App-level infrastructure shared by all servers. Session-scoped state is created per request in {@link createServerFromConfig}. */
export type SharedServerServices = {
    config: UserConfig;
    serverMetadata: ServerMetadata;
    tools: ToolRegistry;
    resources: ResourceRegistry;
    logger: CompositeLogger;
    metrics: IMetrics;
    keychain: Keychain;
    deviceId: IDeviceId;
    connectionStore: MCPConnectionStore;
    atlasLocalClient: AtlasLocalClient | undefined;
    monitoringServer: ReturnType<typeof createMonitoringServerFromConfig>;
};

/** Builds metrics, monitoring server, keychain, device id, connection store and Atlas Local client once. */
export async function createSharedServicesFromConfig(
    options: CreateServerServicesOptions
): Promise<SharedServerServices> {
    const { config, serverMetadata, logger } = options;
    const metrics = new PrometheusMetrics({ definitions: createDefaultMetrics() });
    const monitoringServer = createMonitoringServerFromConfig({ config, logger, metrics });

    const keychain = Keychain.root;
    const deviceId = DeviceId.create(logger);

    // Shared across sessions; each server gets a scoped view per `connectionScope` config.
    const connectionStore = new MCPConnectionStore({ options: config, logger, deviceId });

    const atlasLocalClient = await createAtlasLocalClient({ logger });

    return {
        config,
        serverMetadata,
        tools: options.tools,
        resources: options.resources,
        logger,
        metrics,
        keychain,
        deviceId,
        connectionStore,
        atlasLocalClient,
        monitoringServer,
    };
}

/**
 * Creates one server from a resolved (possibly request-overridden) config.
 * Session-scoped state (McpServer, Session, exports, API client, telemetry,
 * elicitation, connection registry view) is created fresh; everything else
 * comes from `sharedServices`.
 */
export function createServerFromConfig({
    config,
    sharedServices,
}: {
    config: UserConfig;
    sharedServices: SharedServerServices;
}): CliServer {
    const { serverMetadata, tools, resources, logger, metrics, keychain, deviceId, connectionStore, atlasLocalClient } =
        sharedServices;

    // Isolate per-session attributes (e.g. session id set by the HTTP transport).
    const sessionLogger = new CompositeLogger({ loggers: [logger] });

    const exportsManager = createExportsManagerFromConfig({ config, logger: sessionLogger });
    const apiClient = createApiClientFromConfig({ config, serverMetadata, logger: sessionLogger });

    // Fresh scope per session (or shared for `connectionScope: "global"`); owned so closing the session reaps its connections.
    const connectionRegistry: ConnectionRegistry = connectionStore.view({
        scope: config.connectionScope === "session" ? getRandomUUID() : undefined,
        owned: true,
    });

    const telemetry = createTelemetryFromConfig({
        config,
        logger: sessionLogger,
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
        logger: sessionLogger,
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

    return server;
}
