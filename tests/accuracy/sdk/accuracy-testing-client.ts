import { v4 as uuid } from "uuid";
import { experimental_createMCPClient as createMCPClient, tool as createVercelTool } from "ai";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

import { MCP_SERVER_CLI_SCRIPT } from "./constants.js";
import { LLMToolCall } from "./accuracy-snapshot-storage/snapshot-storage.js";

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

    private constructor(private readonly vercelMCPClient: Awaited<ReturnType<typeof createMCPClient>>) {}

    async close() {
        await this.vercelMCPClient?.close();
    }

    async vercelTools() {
        const vercelTools = (await this.vercelMCPClient?.tools()) ?? {};
        const rewrappedVercelTools: typeof vercelTools = {};
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

    getLLMToolCalls() {
        return this.llmToolCalls;
    }

    mockTools(mockedTools: MockedTools) {
        this.mockedTools = mockedTools;
    }

    resetForTests() {
        this.mockTools({});
        this.llmToolCalls = [];
    }

    static async initializeClient(mdbConnectionString: string) {
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
