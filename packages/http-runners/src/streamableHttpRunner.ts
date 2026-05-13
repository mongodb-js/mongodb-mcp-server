import type { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { DefaultMetricDefinitions, ISessionStore, IMetrics } from "@mongodb-js/mcp-types";
import type { CompositeLogger } from "@mongodb-js/mcp-core";
import { LogId, TransportRunnerBase } from "@mongodb-js/mcp-core";
import { MCPHttpServer, type SessionAwareServer } from "./mcpHttpServer.js";
import { MonitoringServer } from "./monitoringServer.js";

export { MonitoringServer, MCPHttpServer, type SessionAwareServer };

/**
 * Options for StreamableHttpRunner.
 */
export type StreamableHttpRunnerOptions<TMetrics extends DefaultMetricDefinitions = DefaultMetricDefinitions> = {
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
    TMetrics extends DefaultMetricDefinitions = DefaultMetricDefinitions,
> extends TransportRunnerBase {
    protected readonly mcpHttpServer: MCPHttpServer<TServer, TMetrics>;
    protected readonly monitoringServer: MonitoringServer<TMetrics> | undefined;
    protected readonly sessionStore: ISessionStore<StreamableHTTPServerTransport>;
    protected readonly logger: CompositeLogger;
    protected readonly metrics: IMetrics<TMetrics>;

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
        super();
        this.logger = logger;
        this.metrics = metrics;
        this.mcpHttpServer = mcpHttpServer;
        this.monitoringServer = monitoringServer;
        this.sessionStore = sessionStore;
    }

    /** Starts the transport runner. */
    async start(): Promise<void> {
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
    async close(): Promise<void> {
        await Promise.allSettled([this.mcpHttpServer.stop(), this.monitoringServer?.stop()]);
    }
}
