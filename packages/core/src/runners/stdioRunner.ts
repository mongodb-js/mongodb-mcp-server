import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { MetricDefinitions, DefaultMetricDefinitions, IMetrics } from "@mongodb-js/mcp-types";
import type { CompositeLogger } from "../logging/compositeLogger.js";
import { LogId } from "../logId.js";
import { TransportRunnerBase } from "../transportRunnerBase.js";

/**
 * Transport runner for stdio (standard input/output) transport.
 * This is the default transport for MCP servers.
 *
 * @example
 * ```typescript
 * const runner = new StdioRunner({
 *   logger: compositeLogger,
 *   metrics: new NoopMetrics(),
 *   server: myServer,
 * });
 * await runner.start();
 * ```
 */
export class StdioRunner<
    TServer extends {
        connect(transport: StdioServerTransport): Promise<void>;
        close(): Promise<void>;
    } = {
        connect(transport: StdioServerTransport): Promise<void>;
        close(): Promise<void>;
    },
    TMetrics extends MetricDefinitions = DefaultMetricDefinitions,
> extends TransportRunnerBase<TMetrics> {
    private server: TServer;

    constructor({
        logger,
        metrics,
        server,
    }: {
        logger: CompositeLogger;
        metrics: IMetrics<TMetrics>;
        server: TServer;
    }) {
        super({ logger, metrics });
        this.server = server;
    }

    async start(): Promise<void> {
        try {
            const transport = new StdioServerTransport();
            await this.server.connect(transport);
        } catch (error: unknown) {
            this.logger.emergency({
                id: LogId.serverStartFailure,
                context: "server",
                message: `Fatal error running server: ${error as string}`,
            });
            process.exit(1);
        }
    }

    /**
     * Stops the stdio transport runner.
     * This closes the server connection.
     */
    async stop(): Promise<void> {
        await this.server.close();
    }
}
