import { MCPHttpServer, type SessionAwareServer } from "@mongodb-js/mcp-http-runners";
import type { SessionStore } from "@mongodb-js/mcp-core";
import type { HttpServerOptions, SessionManagementOptions } from "@mongodb-js/mcp-types";
import type { CompositeLogger } from "@mongodb-js/mcp-core";
import type { IMetrics, DefaultMetricDefinitions } from "@mongodb-js/mcp-types";
import type { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { StartableServer } from "../types.js";

export class MCPHttpServerWrapper extends MCPHttpServer<SessionAwareServer> {
    private server: SessionAwareServer;

    constructor({
        server,
        options,
        logger,
        metrics,
        sessionStore,
    }: {
        server: StartableServer;
        options: {
            http: HttpServerOptions;
            session: SessionManagementOptions;
        };
        logger: CompositeLogger;
        metrics: IMetrics<DefaultMetricDefinitions>;
        sessionStore: SessionStore<StreamableHTTPServerTransport>;
    }) {
        super({ options, logger, metrics, sessionStore });
        // Cast to SessionAwareServer since we know the server satisfies the interface at runtime
        this.server = server as SessionAwareServer;
    }

    protected override async createServerForRequest(): Promise<SessionAwareServer> {
        return this.server;
    }
}
