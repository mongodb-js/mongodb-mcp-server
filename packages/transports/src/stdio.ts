import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { MetricDefinitions } from "@mongodb-js/mcp-types";
import { LogId } from "@mongodb-js/mcp-core";
import { TransportRunnerBase } from "./base.js";
import type { StdioRunnerOptions, CustomizableServerOptions, CustomizableSessionOptions } from "./types.js";

/**
 * Transport runner for stdio (standard input/output) transport.
 * This is the default transport for MCP servers.
 *
 * To customize server creation, extend this class and override the `createServer()` method:
 *
 * @example
 * ```typescript
 * class MyStdioRunner extends StdioRunner {
 *   protected override async createServer({ serverOptions, sessionOptions }) {
 *     return new MyServer({ ... });
 *   }
 * }
 *
 * const runner = new MyStdioRunner({ loggers, metrics });
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
    TContext = unknown,
    TMetrics extends MetricDefinitions = MetricDefinitions,
> extends TransportRunnerBase<TServer, TContext, TMetrics> {
    private server: TServer | undefined;

    constructor({ loggers, metrics }: StdioRunnerOptions<TMetrics>) {
        super({ loggers, metrics });
    }

    async start({
        serverOptions,
        sessionOptions,
    }: {
        serverOptions?: CustomizableServerOptions<TContext>;
        sessionOptions?: CustomizableSessionOptions;
    } = {}): Promise<void> {
        try {
            this.server = await this.createServer({ serverOptions, sessionOptions });
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
        await this.server?.close();
    }

    /**
     * Creates the server instance. Must be implemented by subclasses.
     */
    protected abstract createServer({
        serverOptions,
        sessionOptions,
    }: {
        serverOptions?: CustomizableServerOptions<TContext>;
        sessionOptions?: CustomizableSessionOptions;
    }): Promise<TServer>;
}
