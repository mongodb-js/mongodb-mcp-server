import { MCPHttpServer, StreamableHttpRunner } from "@mongodb-js/mcp-http-runners";
import { SessionStore } from "@mongodb-js/mcp-core";
import type { NodeStreamableHTTPServerTransport } from "@modelcontextprotocol/node";
import type { HttpServerOptions, SessionManagementOptions } from "@mongodb-js/mcp-types";
import type { TransportRequestContext } from "@mongodb-js/mcp-types";
import type { CliServer } from "./cliServer.js";
import { createServerFromConfig, type SharedServerServices } from "./createServerServices.js";
import { applyConfigOverrides } from "./config/configOverrides.js";

export type CliMcpHttpServerOptions = {
    http: HttpServerOptions;
    session: SessionManagementOptions;
};

/**
 * HTTP server that creates a fresh {@link CliServer} per session, applying
 * request-level config overrides (`applyConfigOverrides`). App-level
 * infrastructure comes from {@link SharedServerServices}.
 */
export class CliMcpHttpServer extends MCPHttpServer<CliServer> {
    private readonly sharedServices: SharedServerServices;

    constructor({
        sharedServices,
        sessionStore,
        options,
    }: {
        sharedServices: SharedServerServices;
        sessionStore: SessionStore<NodeStreamableHTTPServerTransport>;
        options: CliMcpHttpServerOptions;
    }) {
        super({
            options,
            logger: sharedServices.logger,
            metrics: sharedServices.metrics,
            sessionStore,
        });
        this.sharedServices = sharedServices;
    }

    protected override async createServerForRequest(request: TransportRequestContext): Promise<CliServer> {
        const config = applyConfigOverrides({ baseConfig: this.sharedServices.config, request });

        return Promise.resolve(createServerFromConfig({ config, sharedServices: this.sharedServices }));
    }
}

/** Creates the HTTP transport runner with a {@link CliMcpHttpServer} and shared infrastructure. */
export function createHttpTransportRunnerFromConfig(sharedServices: SharedServerServices): StreamableHttpRunner {
    const { config, logger, metrics, monitoringServer } = sharedServices;

    const sessionStore = new SessionStore<NodeStreamableHTTPServerTransport>({
        options: {
            idleTimeoutMS: config.idleTimeoutMs,
            notificationTimeoutMS: config.notificationTimeoutMs,
            maxSessions: config.maxSessions,
        },
        logger,
        metrics,
    });

    const mcpHttpServer = new CliMcpHttpServer({
        sharedServices,
        sessionStore,
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
    });

    return new StreamableHttpRunner({
        logger,
        mcpHttpServer,
        monitoringServer,
    });
}
