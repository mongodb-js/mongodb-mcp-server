import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Server } from "../server.js";
import type { CustomizableServerOptions } from "./base.js";
import type { CustomizableSessionOptions } from "./base.js";
import { TransportRunnerBase, type TransportRunnerConfig } from "./base.js";
import type { UserConfig } from "../lib.js";
import type { DefaultMetrics } from "@mongodb-js/mcp-metrics";

export class StdioRunner<
    TUserConfig extends UserConfig = UserConfig,
    TContext = unknown,
    TMetrics extends DefaultMetrics = DefaultMetrics,
> extends TransportRunnerBase<TUserConfig, TContext, TMetrics> {
    private server: Server<TUserConfig, TContext> | undefined;

    constructor(config: TransportRunnerConfig<TUserConfig, TMetrics>) {
        super(config);
    }

    async start({
        serverOptions,
        sessionOptions,
    }: {
        serverOptions?: CustomizableServerOptions<TUserConfig, TContext>;
        sessionOptions?: CustomizableSessionOptions<TUserConfig>;
    } = {}): Promise<void> {
        this.server = await this.createServer({ serverOptions, sessionOptions });
        const transport = new StdioServerTransport();

        await this.server.connect(transport);
    }

    async closeTransport(): Promise<void> {
        await this.server?.close();
    }
}
