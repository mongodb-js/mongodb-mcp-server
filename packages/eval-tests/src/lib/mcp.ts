import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { experimental_createMCPClient } from "@ai-sdk/mcp";
import { tool as createTool, type Tool } from "ai";
import { createServicesFromConfig, Resources, UserConfigSchema, type UserConfig } from "@mongodb-js/mcp-cli";
import { AllTools, packageInfo } from "mongodb-mcp-server";

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
 * This class launches MongoDB MCP Server in memory and exposes its tools in Vercel compatible AI SDK format.
 */
export class InMemoryMcpConnection {
    private constructor(
        private readonly mcpClient: McpClient,
        private readonly shutdown: () => Promise<void>
    ) {}

    static async create(userConfig: Partial<UserConfig> & { connectionString: string }): Promise<McpClient> {
        const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

        const config = UserConfigSchema.parse({
            telemetry: "disabled",
            loggers: ["mcp"],
            ...userConfig,
        });

        const { server } = await createServicesFromConfig({
            config,
            serverMetadata: packageInfo,
            tools: AllTools,
            resources: Resources,
        });

        await server.connect(serverTransport);

        const client = await experimental_createMCPClient({
            transport: clientTransport,
        });

        return new InMemoryMcpConnection(client, async () => {
            await clientTransport.close();
            await server.close();
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
