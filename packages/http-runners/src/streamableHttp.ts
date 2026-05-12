import type { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { MetricDefinitions, DefaultMetricDefinitions, ISessionStore, IMetrics } from "@mongodb-js/mcp-types";
import type { CompositeLogger } from "@mongodb-js/mcp-core";
import { LogId, TransportRunnerBase } from "@mongodb-js/mcp-core";
import { MCPHttpServer, type SessionAwareServer } from "./mcpHttpServer.js";
import { MonitoringServer } from "./monitoringServer.js";

export { MonitoringServer, MCPHttpServer, type SessionAwareServer };

/**
 * Options for StreamableHttpRunner.
 */
export type StreamableHttpRunnerOptions<TMetrics extends MetricDefinitions = DefaultMetricDefinitions> = {
    /** Logger instance */
    logger: CompositeLogger;

    /** Metrics instance */
    metrics: IMetrics<TMetrics>;
};

/**
 * Transport runner for HTTP transport with streamable responses.
 * Supports both SSE and JSON response types.
 *
 * Server creation is handled by the `MCPHttpServer` instance passed to the constructor.
 * To customize per-request server creation, extend `MCPHttpServer` and override
 * the `createServerForRequest()` method.
 */
export class StreamableHttpRunner<
    TServer extends SessionAwareServer = SessionAwareServer,
    TMetrics extends MetricDefinitions = DefaultMetricDefinitions,
> extends TransportRunnerBase<TMetrics> {
    protected mcpHttpServer: MCPHttpServer<TServer, TMetrics>;
    protected monitoringServer: MonitoringServer<TMetrics> | undefined;
    protected sessionStore: ISessionStore<StreamableHTTPServerTransport>;

    constructor({
        logger,
        metrics,
        mcpHttpServer,
        monitoringServer,
        sessionStore,
    }: StreamableHttpRunnerOptions<TMetrics> & {
        mcpHttpServer: MCPHttpServer<TServer, TMetrics>;
        monitoringServer?: MonitoringServer<TMetrics>;
        sessionStore: ISessionStore<StreamableHTTPServerTransport>;
    }) {
        super({ logger, metrics });
        this.mcpHttpServer = mcpHttpServer;
        this.monitoringServer = monitoringServer;
        this.sessionStore = sessionStore;
    }

    /** Starts the transport runner. */
    async start(): Promise<void> {
        this.validateConfig();

        await this.mcpHttpServer.start();

        // Start the monitoring server if one exists
        await this.monitoringServer?.start();

        this.logger.info({
            message: "Streamable HTTP Transport started",
            context: "streamableHttpTransport",
            id: LogId.streamableHttpTransportStarted,
        });
    }

    /**
     * Stops the HTTP transport runner.
     * This stops the MCP HTTP server and monitoring server.
     */
    async stop(): Promise<void> {
        await Promise.all([this.mcpHttpServer?.stop(), this.monitoringServer?.stop()]);
    }

    private shouldWarnAboutHttpHost(httpHost: string): boolean {
        const host = httpHost.trim();
        const safeHosts = new Set(["127.0.0.1", "localhost", "::1"]);
        return host === "0.0.0.0" || host === "::" || (!safeHosts.has(host) && host !== "");
    }

    private validateConfig(): void {
        // Get the HTTP config from the mcp server to validate
        const httpConfig = this.mcpHttpServer.httpOptions;

        // Check for potentially unsafe host binding
        if (this.shouldWarnAboutHttpHost(httpConfig.host)) {
            this.logger.warning({
                id: LogId.streamableHttpTransportHttpHostWarning,
                context: "streamableHttpTransport",
                message: `Binding to ${httpConfig.host} can expose the MCP Server to the entire local network, which allows other devices on the same network to potentially access the MCP Server. This is a security risk and could allow unauthorized access to your database context.`,
                noRedaction: true,
            });
        }
    }
}
