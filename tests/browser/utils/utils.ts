import { Client } from "@modelcontextprotocol/sdk/client";
import { TransportRunnerBase } from "@mongodb-js/mcp-core";
import type { TransportRunnerBaseOptions } from "@mongodb-js/mcp-core";

export class BrowserTestRunner extends TransportRunnerBase {
    private client: Client | null = null;

    constructor(options: TransportRunnerBaseOptions) {
        super(options);
    }

    start(): Promise<void> {
        // Create MCP client
        this.client = new Client(
            {
                name: "browser-test-client",
                version: "1.0.0",
            },
            {
                capabilities: {},
            }
        );
        return Promise.resolve();
    }

    async stop(): Promise<void> {
        await this.client?.close();
    }

    async closeTransport(): Promise<void> {
        await this.client?.close();
    }

    getClient(): Client | null {
        return this.client;
    }
}
