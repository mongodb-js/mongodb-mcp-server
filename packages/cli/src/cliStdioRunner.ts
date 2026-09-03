import { StdioRunner } from "@mongodb-js/mcp-core";
import type { McpServer } from "@modelcontextprotocol/server";
import { createServerFromConfig, type SharedServerServices } from "./createServerServices.js";

/**
 * Stdio runner that creates a fresh {@link CliServer} per stdio connection.
 * App-level infrastructure comes from {@link SharedServerServices}.
 */
export class CliStdioRunner extends StdioRunner {
    private readonly sharedServices: SharedServerServices;

    constructor({ sharedServices }: { sharedServices: SharedServerServices }) {
        super({ logger: sharedServices.logger });
        this.sharedServices = sharedServices;
    }

    protected override async createServer(): Promise<McpServer> {
        const server = createServerFromConfig({
            config: this.sharedServices.config,
            sharedServices: this.sharedServices,
        });
        await server.register();
        return server.mcpServer;
    }
}
