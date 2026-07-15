import { Client } from "@modelcontextprotocol/sdk/client";
import { TransportRunnerBase, type TransportRunnerConfig } from "mongodb-mcp-server/web";

export class BrowserTestRunner extends TransportRunnerBase {
    private client: Client | null = null;

    constructor(config: TransportRunnerConfig) {
        super(config);
    }

    async start(): Promise<void> {
        await this.setupServer();

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
    }

    async closeTransport(): Promise<void> {
        await this.client?.close();
    }

    getClient(): Client | null {
        return this.client;
    }
}
