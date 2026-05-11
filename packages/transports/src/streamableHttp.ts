import type { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { MetricDefinitions, ISessionStore, IMetrics, TransportRequestContext } from "@mongodb-js/mcp-types";
import type { LoggerBase } from "@mongodb-js/mcp-core";
import { LogId } from "@mongodb-js/mcp-core";
import { TransportRunnerBase } from "./base.js";
import { MCPHttpServer } from "./mcpHttpServer.js";
import { MonitoringServer } from "./monitoringServer.js";
import type { CustomizableServerOptions, CustomizableSessionOptions } from "./types.js";

export { MonitoringServer, MCPHttpServer };

// Re-export error codes
export {
    JSON_RPC_ERROR_CODE_PROCESSING_REQUEST_FAILED,
    JSON_RPC_ERROR_CODE_SESSION_ID_REQUIRED,
    JSON_RPC_ERROR_CODE_SESSION_ID_INVALID,
    JSON_RPC_ERROR_CODE_SESSION_NOT_FOUND,
    JSON_RPC_ERROR_CODE_INVALID_REQUEST,
    JSON_RPC_ERROR_CODE_DISALLOWED_EXTERNAL_SESSION,
} from "./jsonRpcErrorCodes.js";

/**
 * Options for StreamableHttpRunner.
 */
export type StreamableHttpRunnerOptions<TMetrics extends MetricDefinitions = MetricDefinitions> = {
    /** Optional loggers to use */
    loggers?: LoggerBase[];

    /** Optional metrics instance */
    metrics?: IMetrics<TMetrics>;
};

/**
 * Transport runner for HTTP transport with streamable responses.
 * Supports both SSE and JSON response types.
 *
 * To customize server creation, extend this class and override the `createServer()` method:
 *
 * @example
 * ```typescript
 * class MyStreamableHttpRunner extends StreamableHttpRunner {
 *   protected override async createServer({ serverOptions, sessionOptions, request }) {
 *     // Custom server creation logic
 *     return new MyServer({ ... });
 *   }
 * }
 * ```
 */
export class StreamableHttpRunner<
    TServer extends {
        connect(transport: StreamableHTTPServerTransport): Promise<void>;
        close(): Promise<void>;
        session?: { logger: { setAttribute(key: string, value: string): void } };
    } = {
        connect(transport: StreamableHTTPServerTransport): Promise<void>;
        close(): Promise<void>;
        session?: { logger: { setAttribute(key: string, value: string): void } };
    },
    TContext = unknown,
    TMetrics extends MetricDefinitions = MetricDefinitions,
> extends TransportRunnerBase<TServer, TContext, TMetrics> {
    protected mcpHttpServer: MCPHttpServer<TServer, TContext, TMetrics>;
    protected monitoringServer: MonitoringServer<TMetrics> | undefined;
    protected sessionStore: ISessionStore<StreamableHTTPServerTransport>;

    constructor({
        loggers,
        metrics,
        mcpHttpServer,
        monitoringServer,
        sessionStore,
    }: StreamableHttpRunnerOptions<TMetrics> & {
        mcpHttpServer: MCPHttpServer<TServer, TContext, TMetrics>;
        monitoringServer?: MonitoringServer<TMetrics>;
        sessionStore: ISessionStore<StreamableHTTPServerTransport>;
    }) {
        super({ loggers, metrics });
        this.mcpHttpServer = mcpHttpServer;
        this.monitoringServer = monitoringServer;
        this.sessionStore = sessionStore;
    }

    /** Starts the transport runner. */
    async start(
        // eslint-disable-next-line @typescript-eslint/no-unused-vars -- Used by subclasses
        _options: {
            serverOptions?: CustomizableServerOptions<TContext>;
            sessionOptions?: CustomizableSessionOptions;
        } = {}
    ): Promise<void> {
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

    /**
     * Creates a server instance. This method is required by the base class but
     * is not used by StreamableHttpRunner since server creation happens inside
     * MCPHttpServer. This stub implementation throws an error if called.
     */
    protected createServer(
        // eslint-disable-next-line @typescript-eslint/no-unused-vars -- Required by base class signature
        _options: {
            serverOptions?: CustomizableServerOptions<TContext>;
            sessionOptions?: CustomizableSessionOptions;
        }
    ): Promise<TServer> {
        throw new Error(
            "StreamableHttpRunner.createServer() should not be called directly. " +
                "Server creation is handled by the MCPHttpServer's createServer callback."
        );
    }

    /**
     * Creates a server instance for a specific request.
     * Override this method in subclasses to customize per-request server creation.
     */
    protected createServerForRequest(_options: {
        serverOptions?: CustomizableServerOptions<TContext>;
        sessionOptions?: CustomizableSessionOptions;
        request: TransportRequestContext;
    }): Promise<TServer> {
        // Default implementation just creates a regular server
        // Subclasses can override to customize based on the request
        return this.createServer({ serverOptions: _options.serverOptions, sessionOptions: _options.sessionOptions });
    }

    private shouldWarnAboutHttpHost(httpHost: string): boolean {
        const host = httpHost.trim();
        const safeHosts = new Set(["127.0.0.1", "localhost", "::1"]);
        return host === "0.0.0.0" || host === "::" || (!safeHosts.has(host) && host !== "");
    }

    private validateConfig(): void {
        // Get the HTTP config from the mcp server to validate
        const httpConfig = this.mcpHttpServer.httpConfig;

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
