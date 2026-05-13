import { Client } from "@modelcontextprotocol/sdk/client";
import { TransportRunnerBase } from "@mongodb-js/mcp-core";

export class BrowserTestRunner extends TransportRunnerBase {
    private _client: Client | null = null;

    get client(): Client | null {
        return this._client;
    }

    constructor() {
        super();
    }

    async start(): Promise<void> {
        // Create MCP client
        this._client = new Client(
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

    async close(): Promise<void> {
        await this.client?.close();
    }
}
