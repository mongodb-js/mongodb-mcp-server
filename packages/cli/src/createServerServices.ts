import { PrometheusMetrics, createDefaultMetrics } from "@mongodb-js/mcp-metrics";
import type { CompositeLogger } from "@mongodb-js/mcp-core";
import { Elicitation, Keychain, McpServer, LogId } from "@mongodb-js/mcp-core";
import type {
    IMetrics,
    IDeviceId,
    ServerMetadata,
    TransportRequestContext,
    ConnectionScopePolicy,
} from "@mongodb-js/mcp-types";
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
export async function createSharedServicesFromConfig(
    options: CreateServerServicesOptions
): Promise<SharedServerServices> {
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
 * scoping in unauthenticated deployments (see
 * {@link connectionScopeByClientNameHeader}). Self-asserted and never an
 * authorization boundary.
 *
 * Deliberately outside the `x-mongodb-mcp-` prefix used by request config
 * overrides (see applyConfigOverrides), so it is never mistaken for one.
 */
export const CLIENT_SCOPE_HEADER = "x-mcp-client-name";

/**
 * Opt-in labeling for unauthenticated deployments (e.g. the CLI's own HTTP
 * runner): scopes by the self-asserted {@link CLIENT_SCOPE_HEADER} header.
 * The label is client-controlled and must not be used as an authorization
 * boundary; requests without it get an ephemeral scope.
 */
export function connectionScopeByClientNameHeader(request: TransportRequestContext): string | undefined {
    const header = request.headers?.[CLIENT_SCOPE_HEADER];
    return (typeof header === "string" && header.trim()) || undefined;
}

/**
 * The scope key every request resolves to under `connectionScope: "global"`:
 * one namespace shared by all clients, surviving session rotation — the
 * v2.x `connectionScope: "global"` behavior.
 */
export const GLOBAL_CONNECTION_SCOPE = "global";

/**
 * The `mcp-session-id` header. On the sessionful (legacy) path the server
 * issues this id; on the sessionless (desktop 2026-07-28) path a client may
 * supply one. In both cases requests that share a session id resolve to the
 * same connection scope, so connections persist across a session's requests.
 */
export const SESSION_ID_HEADER = "mcp-session-id";

/** Guards against an absurdly large session id being used as a scope key. */
const MAX_SESSION_ID_LENGTH = 512;

/**
 * Scope keyed on the client's `mcp-session-id`: requests carrying the same id
 * (whether a server-issued legacy session id or a client-supplied one on the
 * sessionless path) share connections, enabling cross-request persistence. A
 * request without a usable id returns `undefined` (the caller decides the
 * fallback — {@link connectionScopeFromConfig} shares the global scope on the
 * sessionless path, ephemeral otherwise). The id is a capability token —
 * unguessable when server-issued, self-asserted otherwise — so possession of it
 * is what grants access to the scope's connections.
 */
export function connectionScopeBySessionId(request: TransportRequestContext): string | undefined {
    const header = request.headers?.[SESSION_ID_HEADER];
    if (typeof header !== "string") {
        return undefined;
    }
    const id = header.trim();
    return id && id.length <= MAX_SESSION_ID_LENGTH ? id : undefined;
}

/**
 * Derives the CLI runner's connection-scope policy from the user config — the
 * `connectionScope` option restored from v2.x:
 *  - `"session"` (default): connection scope keyed on the client's
 *    `mcp-session-id` — requests that carry the same session id share a scope
 *    (persisting their connections across requests). When a request has no
 *    usable session id, the sessionless 2026-07-28 path falls back to the
 *    shared scope ({@link GLOBAL_CONNECTION_SCOPE}) so anonymous clients can
 *    still persist connections across requests, while the sessionful legacy
 *    path (which always has a server-issued session) stays ephemeral.
 *  - `"global"`: every request shares one scope ({@link GLOBAL_CONNECTION_SCOPE}),
 *    so connections are visible to all clients and survive session rotation.
 */
export function connectionScopeFromConfig(config: UserConfig): ConnectionScopePolicy {
    if (config.connectionScope === "global") {
        return () => GLOBAL_CONNECTION_SCOPE;
    }
    return (request) => {
        const id = connectionScopeBySessionId(request);
        // No usable session id. On the sessionless (2026-07-28) path this server
        // has no session machinery, so share the global scope so anonymous
        // clients can still persist connections. The legacy sessionful path
        // always has a server-issued session; leave it ephemeral (undefined).
        return id ?? (request.protocol === "2026-07-28" ? GLOBAL_CONNECTION_SCOPE : undefined);
    };
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
 * every heavy dependency comes from {@link SharedServerServices}.
 *
 * When `request` is present (HTTP), the server's connection registry is an
 * isolated scoped view over the shared store, keyed by the
 * `connectionScope` policy: connections in a scope survive across requests
 * resolving to that scope while staying invisible to every other scope, and a
 * request the policy declines to key (`undefined`) gets an ephemeral scope —
 * no cross-request state, it can never see scoped connections, and its
 * connections are reaped when the request-scoped server closes (on the legacy
 * sessionful path: when the session ends). Without a request (stdio/dry-run,
 * a single client per process) the app-level registry is used as-is.
 */
export function createServerFromConfig({
    config,
    sharedServices,
    request,
    connectionScope,
}: {
    config: UserConfig;
    sharedServices: SharedServerServices;
    request?: TransportRequestContext;
    /**
     * Decides which connection scope HTTP requests get (see
     * {@link ConnectionScopePolicy}) and is required for HTTP — see
     * {@link CliMcpHttpServer}. It is optional here only so non-HTTP callers
     * (stdio, dry-run) that never supply a `request` do not have to set it.
     */
    connectionScope?: ConnectionScopePolicy;
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
    } = sharedServices;

    // HTTP: every request must be scoped — fail closed rather than default to
    // some policy the caller didn't choose (an implicit default is exactly how
    // users end up sharing connections). A policy that returns `undefined`
    // yields an ephemeral scope with no cross-request state. Non-HTTP (no
    // request): the shared registry.
    //
    // `owned` decides what happens when the request-scoped server closes (for
    // the legacy sessionful path: when the session ends). An ephemeral scope
    // dies with its session, so its view is owned and `close()` reaps its
    // connections (the v2.x `connectionScope: "session"` behavior). A stable
    // scope key (a named client, a verified principal, the global scope) is
    // meant to survive the request/session that created the view, so its view
    // is unowned and `close()` leaves the connections alone.
    let requestConnectionRegistry: ConnectionRegistry = connectionRegistry;
    if (request) {
        if (!connectionScope) {
            throw new Error(
                "createServerFromConfig: an HTTP request was provided but no connectionScope policy was set."
            );
        }
        const scope = connectionScope(request);
        requestConnectionRegistry =
            scope !== undefined
                ? connectionStore.view({ scope, owned: false })
                : connectionStore.view({ scope: ephemeralClientScope(), owned: true });
    }

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
    // shared from the app-level {@link SharedServerServices}.
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
        transportRequest: request,
    });
}

/**
 * Closes every app-level service on process shutdown. Order matters: the
 * exports manager and connection store must close while the API client still
 * works (revoking Atlas entries deletes their temporary database users through
 * it), then telemetry flushes last.
 */
export async function closeSharedServices(sharedServices: SharedServerServices): Promise<void> {
    const { telemetry, connectionStore, exportsManager, apiClient } = sharedServices;
    await Promise.allSettled([connectionStore.closeAll(), exportsManager.close()]);
    await Promise.allSettled([apiClient.close(), telemetry.close()]);
}
