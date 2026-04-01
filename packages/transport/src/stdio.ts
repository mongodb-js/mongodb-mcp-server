import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { MCPServer, DefaultMetrics } from "./types.js";
import { TransportRunnerBase, type TransportRunnerConfig } from "./base.js";

export interface StdioRunnerConfig<
    TMetrics extends DefaultMetrics = DefaultMetrics,
> extends TransportRunnerConfig<TMetrics> {
    server: MCPServer;
}

export class StdioRunner<TMetrics extends DefaultMetrics = DefaultMetrics> extends TransportRunnerBase<TMetrics> {
    private readonly server: MCPServer;

    constructor(config: StdioRunnerConfig<TMetrics>) {
        super(config);
        this.server = config.server;
    }

    async start(): Promise<void> {
        try {
            const transport = new StdioServerTransport();
            await this.server.connect(transport);
        } catch (error: unknown) {
            this.logger.emergency({
                id: "serverStartFailure",
                context: "server",
                message: `Fatal error running server: ${String(error)}`,
            });
            process.exit(1);
        }
    }

    async closeTransport(): Promise<void> {
        await this.server.close();
    }
}
