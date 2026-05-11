import type { MetricDefinitions } from "@mongodb-js/mcp-types";
import { TransportRunnerBase } from "./base.js";
import { InMemoryTransport } from "./inMemoryTransport.js";
import type { DryRunModeRunnerOptions, CustomizableServerOptions, CustomizableSessionOptions } from "./types.js";

/**
 * Test helpers interface for dry run mode.
 */
export type DryRunModeTestHelpers = {
    logger: {
        log(this: void, message: string): void;
        error(this: void, message: string): void;
    };
};

/**
 * Transport runner for dry-run mode.
 * Dumps configuration and enabled tools, then exits without starting the server.
 *
 * To customize server creation, extend this class and override the `createServer()` method:
 *
 * @example
 * ```typescript
 * class MyDryRunRunner extends DryRunModeRunner {
 *   protected override async createServer({ serverOptions, sessionOptions }) {
 *     return new MyServer({ ... });
 *   }
 * }
 *
 * const runner = new MyDryRunRunner({ loggers, metrics, consoleLogger });
 * ```
 */
export class DryRunModeRunner<
    TServer extends {
        tools: { name: string; category: string; isEnabled(): boolean }[];
        connect(transport: InMemoryTransport): Promise<void>;
        close(): Promise<void>;
    } = {
        tools: { name: string; category: string; isEnabled(): boolean }[];
        connect(transport: InMemoryTransport): Promise<void>;
        close(): Promise<void>;
    },
    TContext = unknown,
    TMetrics extends MetricDefinitions = MetricDefinitions,
> extends TransportRunnerBase<TServer, TContext, TMetrics> {
    private server: TServer | undefined;
    private consoleLogger: DryRunModeTestHelpers["logger"];
    private serverFactory?: DryRunModeRunnerOptions<TMetrics>["createServer"];

    constructor({ loggers, metrics, consoleLogger, createServer }: DryRunModeRunnerOptions<TMetrics>) {
        super({ loggers, metrics });
        this.consoleLogger = consoleLogger;
        this.serverFactory = createServer;
    }

    override async start({
        serverOptions,
        sessionOptions,
    }: {
        serverOptions?: CustomizableServerOptions<TContext>;
        sessionOptions?: CustomizableSessionOptions;
    } = {}): Promise<void> {
        this.server = await this.createServer({ serverOptions, sessionOptions });
        const transport = new InMemoryTransport();

        await this.server.connect(transport);
        this.dumpTools();
    }

    /**
     * Stops the dry run mode runner.
     * This closes the server connection.
     */
    override async stop(): Promise<void> {
        await this.server?.close();
    }

    private dumpTools(): void {
        const tools =
            this.server?.tools
                .filter((tool) => tool.isEnabled())
                .map((tool) => ({
                    name: tool.name,
                    category: tool.category,
                })) ?? [];
        this.consoleLogger.log("Enabled tools:");
        this.consoleLogger.log(JSON.stringify(tools, null, 2));
    }

    /**
     * Creates the server instance.
     * Uses the serverFactory if provided, otherwise must be overridden by subclasses.
     */
    protected async createServer({
        serverOptions,
        sessionOptions,
    }: {
        serverOptions?: CustomizableServerOptions<TContext>;
        sessionOptions?: CustomizableSessionOptions;
    }): Promise<TServer> {
        if (this.serverFactory) {
            return this.serverFactory({ serverOptions, sessionOptions }) as Promise<TServer>;
        }
        throw new Error(
            "Either provide createServer option or extend DryRunModeRunner and override createServer() method"
        );
    }
}
