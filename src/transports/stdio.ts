import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
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
    constructor(config: TransportRunnerConfig<TUserConfig, TMetrics>) {
        super(config);
    }

    async start(
        input: {
            serverOptions?: CustomizableServerOptions<TUserConfig, TContext>;
            sessionOptions?: CustomizableSessionOptions<TUserConfig>;
        } = {}
    ): Promise<void> {
        const transport = new StdioServerTransport();
        const server = await this.setupServer(undefined, input);
        await server.connect(transport);
    }

    async closeTransport(): Promise<void> {
        // Stdio transport doesn't need explicit cleanup
    }
}
