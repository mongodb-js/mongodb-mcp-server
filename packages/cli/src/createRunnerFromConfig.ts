import { StdioRunner } from "@mongodb-js/mcp-core";
import type { McpServer } from "@modelcontextprotocol/server";
import type { StreamableHttpRunner } from "@mongodb-js/mcp-http-runners";
import {
    createServerFromConfig,
    createSharedServicesFromConfig,
    type CreateServerServicesOptions,
} from "./createServerServices.js";
import { createHttpTransportRunnerFromConfig } from "./cliMcpHttpServer.js";

export type CreateRunnerFromConfigOptions = CreateServerServicesOptions;

export { createServerFromConfig, createSharedServicesFromConfig } from "./createServerServices.js";
export type { SharedServerServices, CreateServerServicesOptions } from "./createServerServices.js";
export { CliMcpHttpServer, createHttpTransportRunnerFromConfig } from "./cliMcpHttpServer.js";

/** Runner for the configured transport: one server per stdio connection, per-request servers for http. */
export async function createRunnerFromConfig(
    options: CreateRunnerFromConfigOptions
): Promise<StdioRunner | StreamableHttpRunner> {
    const { config } = options;
    const sharedServices = await createSharedServicesFromConfig(options);

    if (config.transport === "stdio") {
        // The factory is invoked per stdio connection (serveStdio may build a
        // discarded probe instance first), so each call registers a fresh server.
        return new StdioRunner({
            logger: sharedServices.logger,
            createServer: async (): Promise<McpServer> => {
                const server = createServerFromConfig({ config, sharedServices });
                await server.register();
                return server.mcpServer;
            },
        });
    }
    return createHttpTransportRunnerFromConfig(sharedServices);
}
