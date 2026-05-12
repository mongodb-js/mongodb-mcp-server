import { Client } from "@modelcontextprotocol/sdk/client";
import { TransportRunnerBase } from "@mongodb-js/mcp-core";
import type {
    CustomizableServerOptions,
    CustomizableSessionOptions,
    TransportRunnerBaseOptions,
} from "@mongodb-js/mcp-core";

// Browser-specific server type
interface BrowserServer {
    connect(): Promise<void>;
    close(): Promise<void>;
}

export class BrowserTestRunner extends TransportRunnerBase<BrowserServer> {
    private client: Client | null = null;

    constructor(options: TransportRunnerBaseOptions) {
        super(options);
    }

    protected createServer(
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        _options: {
            serverOptions?: CustomizableServerOptions<unknown>;
            sessionOptions?: CustomizableSessionOptions;
        }
    ): Promise<BrowserServer> {
        // Browser tests don't need a real server
        return Promise.resolve({
            connect: async (): Promise<void> => {},
            close: async (): Promise<void> => {},
        });
    }

    start(
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        _options: {
            serverOptions?: CustomizableServerOptions<unknown>;
            sessionOptions?: CustomizableSessionOptions;
        } = {}
    ): Promise<void> {
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
