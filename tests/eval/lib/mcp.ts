import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { experimental_createMCPClient } from "@ai-sdk/mcp";
import { tool as createTool, type Tool } from "ai";
import {
    type CloseableTransport,
    StdioRunner,
    type TransportRunnerConfig,
    UserConfigSchema,
} from "../../../src/lib.js";

type InternalMcpClient = Awaited<ReturnType<typeof experimental_createMCPClient>>;

export type McpTools = Awaited<ReturnType<InternalMcpClient["tools"]>>;

/**
 * Simplified interface for interacting with an in-memory MCP client.
 * Provides a `tools` method to access available MCP tools and a `close` method to terminate the connection.
 */
export type McpClient = {
    close: () => Promise<void>;
    tools: () => Promise<McpTools>;
};

/**
 * This class is a singleton factory for creating and managing an in-memory MCP connection.
 */
export class InMemoryMcpFactory {
    #instance: InMemoryMcpConnection | null = null;

    constructor(private readonly connectionString: string) {}

    async singletonInstance(): Promise<McpClient> {
        if (!this.#instance) {
            this.#instance = await InMemoryMcpConnection.create(this.connectionString);
        }
        return this.#instance;
    }

    async close(): Promise<void> {
        if (this.#instance) {
            await this.#instance.close();
            this.#instance = null;
        }
    }
}

/**
 * This class launches MongoDB MCP Server in memory and exposes its tools in Vercel compatible AI SDK format.
 */
class InMemoryMcpConnection {
    private constructor(
        private readonly mcpClient: McpClient,
        private readonly shutdown: () => Promise<void>
    ) {}

    static async create(mdbConnectionString: string): Promise<InMemoryMcpConnection> {
        const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

        const runner = new InMemoryMcpRunner({
            userConfig: UserConfigSchema.parse({
                connectionString: mdbConnectionString,
                telemetry: "disabled",
                loggers: ["mcp"],
            }),
        });

        await runner.connect(serverTransport);

        const client = await experimental_createMCPClient({
            transport: clientTransport,
        });

        return new InMemoryMcpConnection(client, async () => {
            await clientTransport.close();
            await runner.disconnect();
        });
    }

    async tools(): Promise<McpTools> {
        const mcpTools = (await this.mcpClient?.tools()) ?? {};
        const wrappedTools: McpTools = {};

        for (const [toolName, tool] of Object.entries(mcpTools)) {
            wrappedTools[toolName] = createTool({
                ...(tool as Tool<unknown, unknown>),
                execute: async (args, options) => {
                    try {
                        return await tool.execute(args, options);
                    } catch (error) {
                        return {
                            isError: true,
                            content:
                                error instanceof Error
                                    ? `${error.name}${error.message ? ": " + error.message : ""}${error.stack ? "\n" + error.stack : ""}`
                                    : String(error),
                        };
                    }
                },
            }) as McpTools[string];
        }

        return wrappedTools;
    }

    async close(): Promise<void> {
        await this.mcpClient?.close();
        await this.shutdown();
    }
}

/**
 * This class creates an MCP runner that uses an in-memory transport instead of stdio or HTTP.
 *
 * This enables the MCP server to run embedded within a Braintrust Eval, which is necessary
 * since Docker-based sandboxed evals are not currently supported on Braintrust.
 */
class InMemoryMcpRunner extends StdioRunner {
    #server?: CloseableTransport;

    constructor(config: TransportRunnerConfig) {
        super(config);
    }

    async connect(serverTransport: Transport): Promise<void> {
        const server = await this.createServer({});
        this.#server = server;
        await server.connect(serverTransport);
    }

    async disconnect(): Promise<void> {
        await this.#server?.close();
        this.#server = undefined;
    }
}
