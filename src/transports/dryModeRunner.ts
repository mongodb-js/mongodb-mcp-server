import type { MetricDefinitions, IMetrics } from "@mongodb-js/mcp-types";
import { TransportRunnerBase, InMemoryTransport } from "@mongodb-js/mcp-core";
import type { CustomizableServerOptions, CustomizableSessionOptions } from "@mongodb-js/mcp-core";
import type { UserConfig } from "../common/config/userConfig.js";

/**
 * Server interface for dry run mode.
 */
export type DryRunServer = {
    tools: Array<{ name: string; category: string; isEnabled(): boolean }>;
    connect(transport: InMemoryTransport): Promise<void>;
    close(): Promise<void>;
};

export type DryRunLogger = { log(log: string): void; error(log: string): void };

/**
 * Options for DryRunModeRunner.
 */
export type DryRunModeRunnerOptions<TMetrics extends MetricDefinitions = MetricDefinitions> = {
    /** User configuration to dump */
    userConfig: UserConfig;
    /** Server instance that provides tools */
    server: DryRunServer;
    /** Optional metrics instance */
    metrics?: IMetrics<TMetrics>;
    /** Console logger for outputting configuration and tools */
    logger: DryRunLogger;
};

/**
 * Transport runner for dry-run mode.
 * Dumps configuration and enabled tools, then exits without starting the server.
 *
 * This is defined in the binary because it depends on UserConfig.
 *
 * @example
 * ```typescript
 * const runner = new DryRunModeRunner({
 *   loggers: [consoleLogger],
 *   userConfig: defaultTestConfig,
 *   server: myServer,
 * });
 * await runner.start();
 * ```
 */
export class DryRunModeRunner<
    TServer extends DryRunServer = DryRunServer,
    TContext = unknown,
    TMetrics extends MetricDefinitions = MetricDefinitions,
> extends TransportRunnerBase<TServer, TContext, TMetrics> {
    private server: TServer;
    private consoleLogger: DryRunLogger;
    private userConfig: UserConfig;

    constructor({ logger, metrics, userConfig, server }: DryRunModeRunnerOptions<TMetrics>) {
        super({ loggers: [], metrics });
        this.userConfig = userConfig;
        this.consoleLogger = logger;
        this.server = server as TServer;
    }

    protected async createServer(): Promise<TServer> {
        return Promise.resolve(this.server);
    }

    override async start({
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        serverOptions,
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        sessionOptions,
    }: {
        serverOptions?: CustomizableServerOptions<TContext>;
        sessionOptions?: CustomizableSessionOptions;
    } = {}): Promise<void> {
        // Dump userConfig
        this.consoleLogger.log("Configuration:");
        this.consoleLogger.log(JSON.stringify(this.userConfig, null, 2));

        // Connect server to a mock transport (required for server contract)
        const transport = new InMemoryTransport();
        await this.server.connect(transport);

        // Dump enabled tools
        this.dumpTools();

        // Close the server
        await this.server.close();
    }

    /**
     * Stops the dry run mode runner.
     */
    override async stop(): Promise<void> {
        await this.server?.close();
    }

    private dumpTools(): void {
        const tools =
            this.server.tools
                .filter((tool) => tool.isEnabled())
                .map((tool) => ({
                    name: tool.name,
                    category: tool.category,
                })) ?? [];
        this.consoleLogger.log("Enabled tools:");
        this.consoleLogger.log(JSON.stringify(tools, null, 2));
    }
}
