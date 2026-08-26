import type { StdioRunner } from "@mongodb-js/mcp-core";
import type { StreamableHttpRunner } from "@mongodb-js/mcp-http-runners";
import { createSharedServicesFromConfig, type CreateServerServicesOptions } from "./createServerServices.js";
import { createHttpTransportRunnerFromConfig } from "./cliMcpHttpServer.js";
import { CliStdioRunner } from "./cliStdioRunner.js";

export type CreateRunnerFromConfigOptions = CreateServerServicesOptions;

export { createServerFromConfig, createSharedServicesFromConfig } from "./createServerServices.js";
export type { SharedServerServices, CreateServerServicesOptions } from "./createServerServices.js";
export { CliMcpHttpServer, createHttpTransportRunnerFromConfig } from "./cliMcpHttpServer.js";
export { CliStdioRunner } from "./cliStdioRunner.js";

/** Runner for the configured transport: one server per stdio connection, per-request servers for http. */
export async function createRunnerFromConfig(
    options: CreateRunnerFromConfigOptions
): Promise<StdioRunner | StreamableHttpRunner> {
    const { config } = options;
    const sharedServices = await createSharedServicesFromConfig(options);

    if (config.transport === "stdio") {
        // createServer is invoked per stdio connection (serveStdio may build a
        // discarded probe instance first), so each call registers a fresh server.
        return new CliStdioRunner({ sharedServices });
    }
    return createHttpTransportRunnerFromConfig(sharedServices);
}
