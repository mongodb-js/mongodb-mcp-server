import { JSONSchema7 } from "json-schema";
import { v4 as uuid } from "uuid";
import { Tool as VercelTool, Schema, tool as createVercelTool, jsonSchema } from "ai";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";

import { InMemoryTransport } from "../../integration/inMemoryTransport.js";
import { defaultTestConfig } from "../../integration/helpers.js";
import { Session } from "../../../src/session.js";
import { Telemetry } from "../../../src/telemetry/telemetry.js";
import { Server } from "../../../src/server.js";
import { ToolCall } from "./accuracy-scorers.js";

type ToolResultGeneratorFn = (...parameters: unknown[]) => CallToolResult | Promise<CallToolResult>;
export type MockedTools = Record<string, ToolResultGeneratorFn>;

function getDefaultToolResultGeneratorFn(): ToolResultGeneratorFn {
    return () => ({
        content: [
            {
                type: "text",
                text: `Mock implementation for tool not present`,
            },
        ],
        isError: true,
    });
}

export class TestTools {
    private mockedTools: MockedTools = {};
    private recordedToolCalls: ToolCall[] = [];

    constructor(private readonly mcpTools: Tool[]) {
        for (const mcpTool of mcpTools) {
            this.mockedTools[mcpTool.name] = getDefaultToolResultGeneratorFn();
        }
    }

    getToolCalls() {
        return this.recordedToolCalls;
    }

    mockTools(mockedTools: MockedTools) {
        for (const toolName in mockedTools) {
            const toolResultGeneratorFn = mockedTools[toolName];
            if (!this.mockedTools[toolName]) {
                throw new Error(`Attempted to mock unrecognized tool - ${toolName}`);
            }

            if (!toolResultGeneratorFn) {
                // Are you happy TS?
                continue;
            }
            this.mockedTools[toolName] = toolResultGeneratorFn;
        }
    }

    vercelAiTools(): Record<string, VercelTool<Schema<unknown>>> {
        const vercelTools: Record<string, VercelTool<Schema<unknown>>> = {};
        for (const tool of this.mcpTools) {
            vercelTools[tool.name] = createVercelTool({
                description: tool.description,
                parameters: jsonSchema(tool.inputSchema as JSONSchema7),
                // eslint-disable-next-line @typescript-eslint/require-await
                execute: async (args: unknown) => {
                    this.recordedToolCalls.push({
                        toolCallId: uuid(),
                        toolName: tool.name,
                        parameters: args,
                    });
                    const toolResultGeneratorFn = this.mockedTools[tool.name];
                    if (!toolResultGeneratorFn) {
                        return {
                            content: [
                                {
                                    type: "text",
                                    text: `Could not resolve tool generator for ${tool.name}`,
                                },
                            ],
                        };
                    }

                    return await toolResultGeneratorFn(args);
                },
            });
        }
        return vercelTools;
    }
}

export async function discoverMongoDBTools(): Promise<Tool[]> {
    let mcpClient: Client | undefined;
    let mcpServer: Server | undefined;
    try {
        const serverTransport = new InMemoryTransport();
        const clientTransport = new InMemoryTransport();

        await serverTransport.start();
        await clientTransport.start();

        void serverTransport.output.pipeTo(clientTransport.input);
        void clientTransport.output.pipeTo(serverTransport.input);

        const session = new Session({
            apiBaseUrl: defaultTestConfig.apiBaseUrl,
        });

        const telemetry = Telemetry.create(session, defaultTestConfig);

        mcpClient = new Client(
            {
                name: "tool-discovery-client",
                version: "0.0.0",
            },
            {
                capabilities: {},
            }
        );

        mcpServer = new Server({
            session,
            userConfig: defaultTestConfig,
            telemetry,
            mcpServer: new McpServer({
                name: "test-server",
                version: "5.2.3",
            }),
        });

        await mcpServer.connect(serverTransport);
        await mcpClient.connect(clientTransport);

        return (await mcpClient.listTools()).tools;
    } finally {
        await mcpClient?.close();
        await mcpServer?.session?.close();
        await mcpServer?.close();
    }
}
