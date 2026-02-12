import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { LogId } from "../common/logger.js";
import type { Server } from "../server.js";
import { TransportRunnerBase, type TransportRunnerConfig } from "./base.js";

export class StdioRunner<TContext = unknown> extends TransportRunnerBase<TContext> {
    private server: Server<TContext> | undefined;

    constructor(config: TransportRunnerConfig<TContext>) {
        super(config);
    }

    async start(): Promise<void> {
        try {
            this.server = await this.setupServer();
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

    async closeTransport(): Promise<void> {
        await this.server?.close();
    }
}
