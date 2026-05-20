import { MCPHttpServer } from "@mongodb-js/mcp-http-runners";
import type { SessionStore } from "@mongodb-js/mcp-core";
import type { HttpServerOptions, SessionManagementOptions } from "@mongodb-js/mcp-types";
import type { SessionServer } from "@mongodb-js/mcp-types";
import type { CompositeLogger } from "@mongodb-js/mcp-core";
import type { IMetrics, DefaultMetricDefinitions } from "@mongodb-js/mcp-types";
import type { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

export class MCPHttpServerWrapper extends MCPHttpServer<SessionServer> {
    private server: SessionServer;

    constructor({
        server,
        options,
        logger,
        metrics,
        sessionStore,
    }: {
        server: SessionServer;
        options: {
            http: HttpServerOptions;
            session: SessionManagementOptions;
        };
        logger: CompositeLogger;
        metrics: IMetrics<DefaultMetricDefinitions>;
        sessionStore: SessionStore<StreamableHTTPServerTransport>;
    }) {
        super({ options, logger, metrics, sessionStore });
        this.server = server;
    }

    protected override async createServerForRequest(): Promise<SessionServer> {
        return Promise.resolve(this.server);
    }
}
