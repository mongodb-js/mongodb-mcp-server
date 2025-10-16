import { v4 as uuid } from "uuid";
import { experimental_createMCPClient as createMCPClient, tool as createVercelTool } from "ai";
import type { ToolCallOptions } from "ai";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

import { MCP_SERVER_CLI_SCRIPT } from "./constants.js";
import type { LLMToolCall } from "./accuracyResultStorage/resultStorage.js";
import type { VercelMCPClient, VercelMCPClientTools } from "./agent.js";
import type { UserConfig } from "../../../src/lib.js";

type ToolResultGeneratorFn = (parameters: Record<string, unknown>) => CallToolResult | Promise<CallToolResult>;
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
                // eslint-disable-next-line
                execute: (async (args: unknown, options: ToolCallOptions) => {
                    this.llmToolCalls.push({
                        toolCallId: uuid(),
                        toolName: toolName,
                        parameters: args as Record<string, unknown>,
                    });
                    try {
                        const toolResultGeneratorFn = this.mockedTools[toolName];
                        if (toolResultGeneratorFn) {
                            return await toolResultGeneratorFn(args as Record<string, unknown>);
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
                }) as any, // eslint-disable-line
            }) as VercelMCPClientTools[string];
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

    static async initializeClient(
        mdbConnectionString: string,
        userConfig: Partial<{ [k in keyof UserConfig]: string }> = {}
    ): Promise<AccuracyTestingClient> {
        const additionalArgs = Object.entries(userConfig).flatMap(([key, value]) => {
            return [`--${key}`, value];
        });

        const args = [MCP_SERVER_CLI_SCRIPT, "--connectionString", mdbConnectionString, ...additionalArgs];

        const clientTransport = new StdioClientTransport({
            command: process.execPath,
            args,
        });

        const client = await createMCPClient({
            transport: clientTransport,
        });

        return new AccuracyTestingClient(client);
    }
}
