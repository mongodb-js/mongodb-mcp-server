import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { MetricDefinitions } from "@mongodb-js/mcp-types";
import {
    LogId,
    TransportRunnerBase,
    type CustomizableServerOptions,
    type CustomizableSessionOptions,
    type TransportRunnerBaseOptions,
} from "@mongodb-js/mcp-core";

/**
 * Transport runner for stdio (standard input/output) transport.
 * This is the default transport for MCP servers.
 *
 * To customize server creation, either provide a createServer callback in options
 * or extend this class and override the `createServer()` method:
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
    private createServerCallback?: (options: {
        serverOptions?: CustomizableServerOptions<TContext>;
        sessionOptions?: CustomizableSessionOptions;
    }) => Promise<TServer>;

    constructor({
        loggers,
        metrics,
        createServer,
    }: TransportRunnerBaseOptions<TMetrics> & {
        createServer?: (options: {
            serverOptions?: CustomizableServerOptions<TContext>;
            sessionOptions?: CustomizableSessionOptions;
        }) => Promise<TServer>;
    }) {
        super({ loggers, metrics });
        this.createServerCallback = createServer;
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
     * Creates the server instance.
     * Uses the createServer callback if provided, otherwise must be overridden by subclasses.
     */
    protected async createServer({
        serverOptions,
        sessionOptions,
    }: {
        serverOptions?: CustomizableServerOptions<TContext>;
        sessionOptions?: CustomizableSessionOptions;
    }): Promise<TServer> {
        if (this.createServerCallback) {
            return this.createServerCallback({ serverOptions, sessionOptions });
        }
        throw new Error("Either provide createServer option or extend StdioRunner and override createServer() method");
    }
}
