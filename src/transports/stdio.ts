import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { LogId } from "../common/logger.js";
import type { Server } from "../server.js";
import type { CustomizableServerOptions } from "./base.js";
import type { CustomizableSessionOptions } from "./base.js";
import { TransportRunnerBase, type TransportRunnerConfig } from "./base.js";
import type { UserConfig } from "../lib.js";

export class StdioRunner<TUserConfig extends UserConfig = UserConfig, TContext = unknown> extends TransportRunnerBase<
    TUserConfig,
    TContext
> {
    private server: Server<TUserConfig, TContext> | undefined;

    constructor(config: TransportRunnerConfig<TUserConfig>) {
        super(config);
    }

    async start({
        serverOptions,
        sessionOptions,
    }: {
        serverOptions?: CustomizableServerOptions<TUserConfig, TContext>;
        sessionOptions?: CustomizableSessionOptions<TUserConfig>;
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

    async closeTransport(): Promise<void> {
        await this.server?.close();
    }
}
