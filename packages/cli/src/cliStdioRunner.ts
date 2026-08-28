import { StdioRunner } from "@mongodb-js/mcp-core";
import type { McpServer } from "@modelcontextprotocol/server";
import { createServerFromConfig, closeAppServices, type AppServices } from "./createServerServices.js";

/**
 * Stdio runner that creates a fresh {@link CliServer} per stdio connection.
 * App-level infrastructure comes from {@link AppServices} and is closed once
 * when the runner stops.
 */
export class CliStdioRunner extends StdioRunner {
    private readonly appServices: AppServices;

    constructor({ appServices }: { appServices: AppServices }) {
        super({ logger: appServices.logger });
        this.appServices = appServices;
    }

    protected override async createServer(): Promise<McpServer> {
        const server = createServerFromConfig({
            config: this.appServices.config,
            appServices: this.appServices,
        });
        await server.register();
        return server.mcpServer;
    }

    /** Stops the stdio runner and releases app-level services. */
    public override async close(): Promise<void> {
        await super.close();
        await closeAppServices(this.appServices);
    }
}
