import { MCPHttpServer, StreamableHttpRunner } from "@mongodb-js/mcp-http-runners";
import type { LegacySessionOptions } from "@mongodb-js/mcp-http-runners";
import type { HttpServerOptions } from "@mongodb-js/mcp-types";
import type { TransportRequestContext, ConnectionScopePolicy } from "@mongodb-js/mcp-types";
import type { CliServer } from "./cliServer.js";
import {
    createServerFromConfig,
    closeSharedServices,
    connectionScopeFromConfig,
    type SharedServerServices,
} from "./createServerServices.js";
import { applyConfigOverrides } from "./config/configOverrides.js";

export type CliMcpHttpServerOptions = {
    http: HttpServerOptions;
    /** Session lifecycle tunables for the 2025-era HTTP transport (cap / timeouts / eviction). */
    sessionOptions?: LegacySessionOptions;
    /**
     * Controls connection isolation for each request — which live connections
     * it can see and use. It must be keyed on whatever distinguishes the
     * callers (e.g. the verified end-user principal for a multi-user OIDC
     * deployment, or the OAuth client id for service-account / M2M tokens) for
     * per-caller isolation with no shared state. See
     * {@link connectionScopeByClientNameHeader} for the CLI's own
     * unauthenticated labeling, and `MCP_SERVER_LIBRARY.md` for a per-user
     * example to copy.
     */
    connectionScope: ConnectionScopePolicy;
};

/**
 * HTTP server that creates a fresh {@link CliServer} per request, applying
 * request-level config overrides (`applyConfigOverrides`). App-level
 * infrastructure comes from {@link SharedServerServices} and never carries per-client
 * state: no sessions, no per-request transports held in memory.
 */
export class CliMcpHttpServer extends MCPHttpServer<CliServer> {
    private readonly sharedServices: SharedServerServices;
    private readonly connectionScope: ConnectionScopePolicy;

    constructor({
        sharedServices,
        options,
    }: {
        sharedServices: SharedServerServices;
        options: CliMcpHttpServerOptions;
    }) {
        // `connectionScope` is required by type (`CliMcpHttpServerOptions`),
        // so no runtime check is needed here; HTTP requests that reach the
        // server always carry one.
        super({
            options,
            logger: sharedServices.logger,
            metrics: sharedServices.metrics,
            sessionOptions: options.sessionOptions,
        });
        this.sharedServices = sharedServices;
        this.connectionScope = options.connectionScope;
    }

    protected override async createServerForRequest(request: TransportRequestContext): Promise<CliServer> {
        const config = applyConfigOverrides({ baseConfig: this.sharedServices.config, request });

        return Promise.resolve(
            createServerFromConfig({
                config,
                sharedServices: this.sharedServices,
                request,
                connectionScope: this.connectionScope,
            })
        );
    }

    /** Stops the HTTP server and releases app-level services. */
    public override async stop(): Promise<void> {
        await super.stop();
        await closeSharedServices(this.sharedServices);
    }
}

/** Creates the HTTP transport runner with a {@link CliMcpHttpServer} and app-level services. */
export function createHttpTransportRunnerFromConfig(sharedServices: SharedServerServices): StreamableHttpRunner {
    const { config, logger, monitoringServer } = sharedServices;

    const mcpHttpServer = new CliMcpHttpServer({
        sharedServices,
        options: {
            http: {
                host: config.httpHost,
                port: config.httpPort,
                responseType: config.httpResponseType,
                headers: config.httpHeaders,
            },
            // The CLI's own runner is a local, unauthenticated deployment: the
            // policy comes from the `connectionScope` config option — "session"
            // (default) isolates per session, with opt-in cross-request state
            // via the self-asserted name header; "global" shares one scope
            // across all clients. Hosts serving authenticated traffic construct
            // CliMcpHttpServer with their own policy.
            connectionScope: connectionScopeFromConfig(config),
            sessionOptions: {
                maxSessions: config.maxSessions,
                idleTimeoutMS: config.idleTimeoutMs,
                notificationTimeoutMS: config.notificationTimeoutMs,
                evictionIdleGraceMS: config.evictionIdleGraceMS,
                externallyManagedSessions: config.externallyManagedSessions,
            },
        },
    });

    return new StreamableHttpRunner({
        logger,
        mcpHttpServer,
        monitoringServer,
    });
}
