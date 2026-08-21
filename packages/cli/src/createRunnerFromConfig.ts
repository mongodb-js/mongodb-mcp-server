import { StdioRunner } from "@mongodb-js/mcp-core";
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

/** Runner for the configured transport: one server for stdio, per-request servers for http. */
export async function createRunnerFromConfig(
    options: CreateRunnerFromConfigOptions
): Promise<StdioRunner | StreamableHttpRunner> {
    const { config } = options;
    const sharedServices = await createSharedServicesFromConfig(options);

    if (config.transport === "stdio") {
        const server = createServerFromConfig({ config, sharedServices });
        return new StdioRunner({ logger: sharedServices.logger, server });
    }
    return createHttpTransportRunnerFromConfig(sharedServices);
}
