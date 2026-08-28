import { MCPHttpServer, StreamableHttpRunner } from "@mongodb-js/mcp-http-runners";
import type { HttpServerOptions } from "@mongodb-js/mcp-types";
import type { TransportRequestContext } from "@mongodb-js/mcp-types";
import type { CliServer } from "./cliServer.js";
import { createServerFromConfig, closeAppServices, type AppServices } from "./createServerServices.js";
import { applyConfigOverrides } from "./config/configOverrides.js";

export type CliMcpHttpServerOptions = {
    http: HttpServerOptions;
};

/**
 * HTTP server that creates a fresh {@link CliServer} per request, applying
 * request-level config overrides (`applyConfigOverrides`). App-level
 * infrastructure comes from {@link AppServices} and never carries per-client
 * state: no sessions, no per-request transports held in memory.
 */
export class CliMcpHttpServer extends MCPHttpServer<CliServer> {
    private readonly appServices: AppServices;

    constructor({ appServices, options }: { appServices: AppServices; options: CliMcpHttpServerOptions }) {
        super({
            options,
            logger: appServices.logger,
            metrics: appServices.metrics,
        });
        this.appServices = appServices;
    }

    protected override async createServerForRequest(request: TransportRequestContext): Promise<CliServer> {
        const config = applyConfigOverrides({ baseConfig: this.appServices.config, request });

        return Promise.resolve(createServerFromConfig({ config, appServices: this.appServices }));
    }

    /** Stops the HTTP server and releases app-level services. */
    public override async stop(): Promise<void> {
        await super.stop();
        await closeAppServices(this.appServices);
    }
}

/** Creates the HTTP transport runner with a {@link CliMcpHttpServer} and app-level services. */
export function createHttpTransportRunnerFromConfig(appServices: AppServices): StreamableHttpRunner {
    const { config, logger, metrics, monitoringServer } = appServices;

    const mcpHttpServer = new CliMcpHttpServer({
        appServices,
        options: {
            http: {
                host: config.httpHost,
                port: config.httpPort,
                responseType: config.httpResponseType,
                headers: config.httpHeaders,
            },
        },
    });

    return new StreamableHttpRunner({
        logger,
        mcpHttpServer,
        monitoringServer,
    });
}
