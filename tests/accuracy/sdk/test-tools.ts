import { JSONSchema7 } from "json-schema";
import { v4 as uuid } from "uuid";
import { Tool as VercelTool, Schema, tool as createVercelTool, jsonSchema } from "ai";
import { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";

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
