import { PrometheusMetrics, createDefaultMetrics } from "@mongodb-js/mcp-metrics";
import type { CompositeLogger } from "@mongodb-js/mcp-core";
import { Elicitation, Keychain, McpServer, LogId } from "@mongodb-js/mcp-core";
import type { IMetrics, IDeviceId, ServerMetadata, TransportRequestContext } from "@mongodb-js/mcp-types";
import type { Client as AtlasLocalClient } from "@mongodb-js/atlas-local";
import type { ResourceRegistry, ToolRegistry } from "./cliServer.js";
import { CliServer } from "./cliServer.js";
import {
    connectionErrorHandler,
    DeviceId,
    MCPConnectionStore,
    validateConnectionString,
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

/**
 * Validates the app-fixed config once at startup: the connection string and
 * Atlas API credentials. These fields are `overrideBehavior: "not-allowed"`,
 * so request-level overrides cannot change them — the validation result is the
 * same for every request, which is why it runs here rather than per request.
 */
export async function validateAppConfig({
    config,
    logger,
    apiClient,
}: {
    config: UserConfig;
    logger: CompositeLogger;
    apiClient: ApiClient;
}): Promise<void> {
    // Validate connection string
    if (config.connectionString) {
        try {
            validateConnectionString(config.connectionString, false);
        } catch (error) {
            throw new Error(
                "Connection string validation failed with error: " +
                    (error instanceof Error ? error.message : String(error)),
                { cause: error }
            );
        }
    }

    // Validate API client credentials
    if (config.apiClientId && config.apiClientSecret) {
        try {
            try {
                const apiBaseUrl = new URL(config.apiBaseUrl);
                if (apiBaseUrl.protocol !== "https:") {
                    // Log a warning, but don't error out. This is to allow for testing against local or non-HTTPS endpoints.
                    const message = `apiBaseUrl is configured to use ${apiBaseUrl.protocol}, which is not secure. It is strongly recommended to use HTTPS for secure communication.`;
                    logger.warning({
                        id: LogId.atlasApiBaseUrlInsecure,
                        context: "server",
                        message,
                    });
                }
            } catch (error) {
                throw new Error(`Invalid apiBaseUrl: ${error instanceof Error ? error.message : String(error)}`, {
                    cause: error,
                });
            }

            await apiClient.validateAuthConfig();
        } catch (error) {
            if (config.connectionString === undefined) {
                throw new Error(
                    `Failed to connect to MongoDB Atlas instance using the credentials from the config: ${error instanceof Error ? error.message : String(error)}`,
                    { cause: error }
                );
            }

            logger.warning({
                id: LogId.atlasCheckCredentials,
                context: "server",
                message: `Failed to validate MongoDB Atlas API client credentials from the config: ${error instanceof Error ? error.message : String(error)}. Continuing since a connection string is also provided.`,
            });
        }
    }
}

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

    // Validate app-fixed config once at startup (see {@link validateAppConfig}).
    await validateAppConfig({ config, logger, apiClient });

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
 * The HTTP header a client may send to identify itself for connection
 * scoping (multi-tenant HTTP deployments). When present, connections the
 * client creates are scoped to this value: they survive across that client's
 * requests (same scope) but are invisible to other clients (different scope).
 * Clients that don't send it share the global registry, matching the
 * pre-Phase-3 behavior.
 *
 * Deliberately outside the `x-mongodb-mcp-` prefix used by request config
 * overrides (see applyConfigOverrides), so it is never mistaken for one.
 */
export const CLIENT_SCOPE_HEADER = "x-mcp-client-name";

/**
 * Derives a connection scope from the request. Precedence:
 *  1. `authInfo.state.clientId` — the verified identity (auth mode): stable,
 *     cannot be forged by the client, so each authenticated client gets its
 *     own isolated namespace.
 *  2. the `x-mcp-client-name` header — opt-in label for unauthenticated
 *     deployments (see {@link CLIENT_SCOPE_HEADER}).
 *  3. none — the caller falls back to an ephemeral scope.
 */
function clientScopeFromRequest(request?: TransportRequestContext): string | undefined {
    if (request?.authInfo?.mode === "authenticated") {
        return request.authInfo.state.clientId;
    }
    const header = request?.headers?.[CLIENT_SCOPE_HEADER];
    const name = typeof header === "string" && header.length > 0 ? header.trim() : undefined;
    return name;
}

/** A fresh, unguessable scope for a request whose client did not identify itself. */
function ephemeralClientScope(): string {
    return `anon:${globalThis.crypto.randomUUID()}`;
}

/**
 * Creates one request-scoped server instance from an effective (possibly
 * request-overridden) config. Only the effective config view, the connection
 * registry view and the request-scoped
 * {@link McpServer}/{@link Elicitation}/{@link CliServer} are created fresh;
 * every heavy dependency comes from {@link AppServices}.
 *
 * When `request` is present (HTTP), the server's connection registry is an
 * isolated scoped+owned view over the shared store: a client that identifies
 * itself (`x-mongodb-mcp-client-name`) gets a stable scope — its connections
 * survive across its requests while staying invisible to other clients — and
 * an anonymous request gets an ephemeral scope (no cross-request state, and
 * it can never see identified clients' connections). Without a request
 * (stdio/dry-run, a single client per process) the app-level registry is
 * used as-is.
 */
export function createServerFromConfig({
    config,
    appServices,
    request,
}: {
    config: UserConfig;
    appServices: AppServices;
    request?: TransportRequestContext;
}): CliServer {
    const {
        serverMetadata,
        tools,
        resources,
        logger,
        metrics,
        keychain,
        connectionRegistry,
        connectionStore,
        apiClient,
        exportsManager,
        telemetry,
        atlasLocalClient,
    } = appServices;

    // HTTP: every request gets an isolated view (identified → stable scope,
    // anonymous → ephemeral scope). Non-HTTP (no request): the shared registry.
    const scope = request ? (clientScopeFromRequest(request) ?? ephemeralClientScope()) : undefined;
    const requestConnectionRegistry =
        scope !== undefined ? connectionStore.view({ scope, owned: true }) : connectionRegistry;

    const mcpServer = new McpServer({
        name: serverMetadata.mcpServerName,
        version: serverMetadata.version,
    });

    const elicitation = new Elicitation({
        server: mcpServer.server,
    });

    // Services are injected individually into the request-scoped server; there
    // is no per-client "session" object. The effective (possibly
    // request-overridden) config and the (possibly client-scoped) connection
    // registry view are the only per-request values — every other service is
    // shared from the app-level {@link AppServices}.
    return new CliServer({
        config,
        logger,
        keychain,
        connectionRegistry: requestConnectionRegistry,
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
        // Validated once at startup by `validateAppConfig`; the per-request
        // server must not re-run the (network) credential validation.
        configValidated: true,
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
