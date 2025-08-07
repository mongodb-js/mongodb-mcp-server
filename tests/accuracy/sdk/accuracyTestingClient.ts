import { v4 as uuid } from "uuid";
import { experimental_createMCPClient as createMCPClient, tool as createVercelTool } from "ai";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

import { MCP_SERVER_CLI_SCRIPT } from "./constants.js";
import { LLMToolCall } from "./accuracyResultStorage/resultStorage.js";
import { VercelMCPClient, VercelMCPClientTools } from "./agent.js";

type ToolResultGeneratorFn = (...parameters: unknown[]) => CallToolResult | Promise<CallToolResult>;
export type MockedTools = Record<string, ToolResultGeneratorFn>;

/**
 * AccuracyTestingClient is a bridge between actual MCP client connected to our
 * MCP server and our Tool calling agent. Its serves the following purposes:
 * 1. Captures actual tools provided by our MCP server
 * 2. Translates captured MCP tools to tool definitions that can be consumed by
 *    Tool Calling agent (Ref: `vercelTools`)
 * 3. Allow dynamic mocking and resetting of mocks of individual tool calls.
 * 4. Records and provides tool calls made by LLMs with their parameters.
 */
export class AccuracyTestingClient {
    private mockedTools: MockedTools = {};
    private llmToolCalls: LLMToolCall[] = [];

    private constructor(private readonly vercelMCPClient: VercelMCPClient) {}

    async close(): Promise<void> {
        await this.vercelMCPClient?.close();
    }

    async vercelTools(): Promise<VercelMCPClientTools> {
        const vercelTools = (await this.vercelMCPClient?.tools()) ?? {};
        const rewrappedVercelTools: VercelMCPClientTools = {};
        for (const [toolName, tool] of Object.entries(vercelTools)) {
            rewrappedVercelTools[toolName] = createVercelTool({
                ...tool,
                execute: async (args, options) => {
                    this.llmToolCalls.push({
                        toolCallId: uuid(),
                        toolName: toolName,
                        parameters: args as Record<string, unknown>,
                    });
                    try {
                        const toolResultGeneratorFn = this.mockedTools[toolName];
                        if (toolResultGeneratorFn) {
                            return await toolResultGeneratorFn(args);
                        }

                        return await tool.execute(args, options);
                    } catch (error) {
                        // There are cases when LLM calls the tools incorrectly
                        // and the schema definition check fails. In production,
                        // the tool calling agents are deployed with this fail
                        // safe to allow LLM to course correct themselves. That
                        // is exactly what we do here as well.
                        return {
                            isError: true,
                            content: JSON.stringify(error),
                        };
                    }
                },
            });
        }

        return rewrappedVercelTools;
    }

    getLLMToolCalls(): LLMToolCall[] {
        return this.llmToolCalls;
    }

    mockTools(mockedTools: MockedTools): void {
        this.mockedTools = mockedTools;
    }

    resetForTests(): void {
        this.mockTools({});
        this.llmToolCalls = [];
    }

    static async initializeClient(mdbConnectionString: string): Promise<AccuracyTestingClient> {
        const clientTransport = new StdioClientTransport({
            command: process.execPath,
            args: [MCP_SERVER_CLI_SCRIPT, "--connectionString", mdbConnectionString],
        });

        const client = await createMCPClient({
            transport: clientTransport,
        });

        return new AccuracyTestingClient(client);
    }
}
