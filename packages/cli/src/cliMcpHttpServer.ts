import { MCPHttpServer, StreamableHttpRunner } from "@mongodb-js/mcp-http-runners";
import type { HttpServerOptions } from "@mongodb-js/mcp-types";
import type { TransportRequestContext } from "@mongodb-js/mcp-types";
import type { CliServer } from "./cliServer.js";
import { createServerFromConfig, closeSharedServices, type SharedServerServices } from "./createServerServices.js";
import { applyConfigOverrides } from "./config/configOverrides.js";

export type CliMcpHttpServerOptions = {
    http: HttpServerOptions;
};

/**
 * HTTP server that creates a fresh {@link CliServer} per request, applying
 * request-level config overrides (`applyConfigOverrides`). App-level
 * infrastructure comes from {@link SharedServerServices} and never carries per-client
 * state: no sessions, no per-request transports held in memory.
 */
export class CliMcpHttpServer extends MCPHttpServer<CliServer> {
    private readonly sharedServices: SharedServerServices;

    constructor({
        sharedServices,
        options,
    }: {
        sharedServices: SharedServerServices;
        options: CliMcpHttpServerOptions;
    }) {
        super({
            options,
            logger: sharedServices.logger,
            metrics: sharedServices.metrics,
        });
        this.sharedServices = sharedServices;
    }

    protected override async createServerForRequest(request: TransportRequestContext): Promise<CliServer> {
        const config = applyConfigOverrides({ baseConfig: this.sharedServices.config, request });

        return Promise.resolve(createServerFromConfig({ config, sharedServices: this.sharedServices, request }));
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
                // The CLI runner is unauthenticated by default; embedders who
                // want enforced authenticated mode construct the HTTP server
                // with authMode: "authenticated" themselves.
                authMode: "unauthenticated",
            },
        },
    });

    return new StreamableHttpRunner({
        logger,
        mcpHttpServer,
        monitoringServer,
    });
}
