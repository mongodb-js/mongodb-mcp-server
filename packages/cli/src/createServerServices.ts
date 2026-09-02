import { PrometheusMetrics, createDefaultMetrics } from "@mongodb-js/mcp-metrics";
import type { CompositeLogger } from "@mongodb-js/mcp-core";
import { Elicitation, Keychain, McpServer } from "@mongodb-js/mcp-core";
import type { IMetrics, IDeviceId, ServerMetadata } from "@mongodb-js/mcp-types";
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
import type { UserConfig } from "./config/userConfig.js";
import { createExportsManagerFromConfig } from "./createExportsManagerFromConfig.js";
import { createApiClientFromConfig } from "./createApiClientFromConfig.js";
import { createTelemetryFromConfig } from "./createTelemetryFromConfig.js";
import { createMonitoringServerFromConfig } from "./createMonitoringServerFromConfig.js";
import type { AtlasTelemetry } from "@mongodb-js/mcp-atlas-telemetry";
import type { ApiClient } from "@mongodb-js/mcp-atlas-api-client";
import type { ExportsManager } from "@mongodb-js/mcp-tools-mongodb";

export type CreateServerServicesOptions = {
    config: UserConfig;
    serverMetadata: ServerMetadata;
    tools: ToolRegistry;
    resources: ResourceRegistry;
    logger: CompositeLogger;
};

/**
 * App-level services constructed once per process and shared by every
 * request-scoped server instance. The server is deliberately stateless: no
 * per-client session state exists anywhere in this object — connections live
 * in the shared `connectionStore`, exports in the shared `exportsManager`,
 * and per-client identity travels on each tool request instead.
 */
export type AppServices = {
    config: UserConfig;
    serverMetadata: ServerMetadata;
    tools: ToolRegistry;
    resources: ResourceRegistry;
    logger: CompositeLogger;
    metrics: IMetrics;
    keychain: Keychain;
    deviceId: IDeviceId;
    connectionStore: MCPConnectionStore;
    /** Shared, app-level registry view over {@link connectionStore}. */
    connectionRegistry: ConnectionRegistry;
    apiClient: ApiClient;
    exportsManager: ExportsManager;
    telemetry: AtlasTelemetry;
    atlasLocalClient: AtlasLocalClient | undefined;
    monitoringServer: ReturnType<typeof createMonitoringServerFromConfig>;
};

/** Builds every app-level service once: metrics, monitoring, keychain, device id, connection store, API client, exports, telemetry, Atlas Local client. */
export async function createAppServicesFromConfig(options: CreateServerServicesOptions): Promise<AppServices> {
    const { config, serverMetadata, logger } = options;
    const metrics = new PrometheusMetrics({ definitions: createDefaultMetrics() });
    const monitoringServer = createMonitoringServerFromConfig({ config, logger, metrics });

    const keychain = Keychain.root;
    const deviceId = DeviceId.create(logger);

    // Shared across requests; a single app-level view ([no scope]) means every
    // request sees the same connections, keyed by opaque connectionId.
    const connectionStore = new MCPConnectionStore({ options: config, logger, deviceId, serverMetadata });
    const connectionRegistry = connectionStore.view();

    const exportsManager = createExportsManagerFromConfig({ config, logger });
    const apiClient = createApiClientFromConfig({ config, serverMetadata, logger });
    const telemetry = createTelemetryFromConfig({
        config,
        logger,
        deviceId,
        apiClient,
        keychain,
        serverMetadata,
    });

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
        connectionRegistry,
        apiClient,
        exportsManager,
        telemetry,
        atlasLocalClient,
        monitoringServer,
    };
}

/**
 * Creates one request-scoped server instance from an effective (possibly
 * request-overridden) config. Only the effective config view and
 * the request-scoped {@link McpServer}/{@link Elicitation}/{@link CliServer}
 * are created fresh; every heavy dependency comes from {@link AppServices}.
 */
export function createServerFromConfig({
    config,
    appServices,
}: {
    config: UserConfig;
    appServices: AppServices;
}): CliServer {
    const {
        serverMetadata,
        tools,
        resources,
        logger,
        metrics,
        keychain,
        connectionRegistry,
        apiClient,
        exportsManager,
        telemetry,
        atlasLocalClient,
    } = appServices;

    const mcpServer = new McpServer({
        name: serverMetadata.mcpServerName,
        version: serverMetadata.version,
    });

    const elicitation = new Elicitation({
        server: mcpServer.server,
    });

    // Services are injected individually into the request-scoped server; there
    // is no per-client "session" object. The effective (possibly
    // request-overridden) config is the only per-request value — every other
    // service is shared from the app-level {@link AppServices}.
    return new CliServer({
        config,
        logger,
        keychain,
        connectionRegistry,
        exportsManager,
        apiClient,
        connectionErrorHandler,
        atlasLocalClient,
        mcpServer,
        telemetry,
        elicitation,
        metrics,
        tools,
        resources,
        serverMetadata,
    });
}

/**
 * Closes every app-level service on process shutdown. Order matters: the
 * exports manager and connection store must close while the API client still
 * works (revoking Atlas entries deletes their temporary database users through
 * it), then telemetry flushes last.
 */
export async function closeAppServices(appServices: AppServices): Promise<void> {
    const { telemetry, connectionStore, exportsManager, apiClient } = appServices;
    await Promise.allSettled([connectionStore.closeAll(), exportsManager.close()]);
    await Promise.allSettled([apiClient.close(), telemetry.close()]);
}
