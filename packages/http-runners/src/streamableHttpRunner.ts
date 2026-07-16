import type { DefaultMetricDefinitions, ITransportRunner } from "@mongodb-js/mcp-types";
import type { CompositeLogger } from "@mongodb-js/mcp-core";
import { LogId } from "@mongodb-js/mcp-core";
import type { MCPHttpServer } from "./mcpHttpServer.js";
import type { SessionServer } from "@mongodb-js/mcp-types";
import type { MonitoringServer } from "./monitoringServer.js";

/**
 * Options for StreamableHttpRunner.
 */
export type StreamableHttpRunnerOptions<
    TServer extends SessionServer = SessionServer,
    TMetrics extends DefaultMetricDefinitions = DefaultMetricDefinitions,
> = {
    /** Logger instance */
    logger: CompositeLogger;
    mcpHttpServer: MCPHttpServer<TServer, TMetrics>;
    monitoringServer?: MonitoringServer<TMetrics>;
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
    TServer extends SessionServer = SessionServer,
    TMetrics extends DefaultMetricDefinitions = DefaultMetricDefinitions,
> implements ITransportRunner {
    protected readonly mcpHttpServer: MCPHttpServer<TServer, TMetrics>;
    protected readonly monitoringServer: MonitoringServer<TMetrics> | undefined;
    protected readonly logger: CompositeLogger;

    constructor({ logger, mcpHttpServer, monitoringServer }: StreamableHttpRunnerOptions<TServer, TMetrics>) {
        this.logger = logger;
        this.mcpHttpServer = mcpHttpServer;
        this.monitoringServer = monitoringServer;
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
