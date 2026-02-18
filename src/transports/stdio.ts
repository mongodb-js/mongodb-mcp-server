import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { LogId } from "../common/logger.js";
import type { Server, ServerOptions } from "../server.js";
import { TransportRunnerBase, type TransportRunnerConfig } from "./base.js";
import type { SessionOptions, UserConfig } from "../lib.js";

export class StdioRunner<TContext = unknown> extends TransportRunnerBase<TContext> {
    private server: Server<TContext> | undefined;

    constructor(config: TransportRunnerConfig) {
        super(config);
    }

    async start({
        userConfig = this.userConfig,
        serverOptions,
        sessionOptions,
    }: {
        userConfig?: UserConfig;
        serverOptions?: ServerOptions<TContext>;
        sessionOptions?: SessionOptions;
    } = {}): Promise<void> {
        try {
            this.server = await this.createServer({ userConfig, serverOptions, sessionOptions });
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
