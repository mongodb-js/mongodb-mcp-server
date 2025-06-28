import { jest } from "@jest/globals";
import { v4 as uuid } from "uuid";
import { DynamicTool, tool as langChainTool } from "@langchain/core/tools";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";

import { InMemoryTransport } from "../../integration/inMemoryTransport.js";
import { defaultTestConfig } from "../../integration/helpers.js";
import { Session } from "../../../src/session.js";
import { Telemetry } from "../../../src/telemetry/telemetry.js";
import { Server } from "../../../src/server.js";
import { AcceptableToolResponse } from "./models.js";
import { ToolCall } from "./accuracy-scorers.js";

type ToolResultGeneratorFn = (...parameters: unknown[]) => CallToolResult;
type MockedToolResultGeneratorFn = jest.MockedFunction<ToolResultGeneratorFn>;
type MockedTools = Record<string, MockedToolResultGeneratorFn>;
export type ToolResultGenerators = Record<string, ToolResultGeneratorFn>;
export type LangChainTool<T extends AcceptableToolResponse> = DynamicTool<T>;
export type ToolResultTransformer<T extends AcceptableToolResponse> = (toolResult: CallToolResult) => T;

export class TestTools {
    private mockedTools: MockedTools = {};
    private recordedToolCalls: ToolCall[] = [];

    constructor(private readonly mcpTools: Tool[]) {
        for (const mcpTool of mcpTools) {
            this.mockedTools[mcpTool.name] = jest.fn<ToolResultGeneratorFn>().mockReturnValue({
                content: [
                    {
                        type: "text",
                        text: `Mock implementation for tool - ${mcpTool.name} not present`,
                    },
                ],
                isError: true,
            });
        }
    }

    getToolCalls() {
        return this.recordedToolCalls;
    }

    mockTools(toolResultGenerators: ToolResultGenerators) {
        for (const toolName in toolResultGenerators) {
            const toolResultGeneratorFn = toolResultGenerators[toolName];
            if (!this.mockedTools[toolName]) {
                throw new Error(`Attempted to mock unrecognized tool - ${toolName}`);
            }

            if (!toolResultGeneratorFn) {
                // Are you happy TS?
                continue;
            }
            this.mockedTools[toolName] = jest.fn(toolResultGeneratorFn);
        }
    }

    langChainTools<T extends AcceptableToolResponse>(
        transformToolResult: ToolResultTransformer<T>
    ): LangChainTool<T>[] {
        return this.mcpTools.map((mcpTool) => {
            return langChainTool((...args) => {
                console.log("????? args", args);
                const [parameters, { runName, runId }] = args;
                const toolCallId = typeof runId !== "undefined" ? `${runId}` : uuid();
                return this.langChainToolResultGenerator(`${runName}`, parameters, toolCallId, transformToolResult);
            }, mcpTool);
        });
    }

    private langChainToolResultGenerator<T extends AcceptableToolResponse>(
        tool: string,
        parameters: unknown,
        toolCallId: string,
        transformToolResult: ToolResultTransformer<T>
    ): T {
        this.recordedToolCalls.push({
            toolCallId: toolCallId,
            toolName: tool,
            parameters,
        });
        const mockedToolResultGenerator = this.mockedTools[tool];
        if (!mockedToolResultGenerator) {
            // log as well
            return transformToolResult({
                content: [
                    {
                        type: "text",
                        text: `Could not resolve tool generator for ${tool}`,
                    },
                ],
                isError: true,
            });
        }

        return transformToolResult(mockedToolResultGenerator(parameters));
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
    } catch (error: unknown) {
        console.error("Unexpected error occured", error);
        return [];
    } finally {
        await mcpClient?.close();
        await mcpServer?.session?.close();
        await mcpServer?.close();
    }
}
