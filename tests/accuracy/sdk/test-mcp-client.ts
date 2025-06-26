import { jest } from "@jest/globals";
import { Tool as MCPTool, CallToolResult as MCPCallToolResult } from "@modelcontextprotocol/sdk/types.js";

/**
 * A minimal interface that is good enough for the purpose of interactions
 * facilitated by an MCP Client.
 */
export interface TestMCPClient {
    listTools(): MCPTool[];
    callTool(toolName: string, ...parameters: unknown[]): MCPCallToolResult;
}

type ToolFnMock = jest.Mock<(...parameters: unknown[]) => MCPCallToolResult>;

/**
 * The MCP client that we primarily use for our accuracy tests. It facilitates
 * mocking away the actual MCP server and allows for mocking individual tools.
 */
export class AccuracyTestMcpClient implements TestMCPClient {
    private readonly toolFns: Record<string, ToolFnMock> = {};

    constructor(private readonly tools: MCPTool[]) {
        for (const tool of tools) {
            this.toolFns[tool.name] = jest.fn<() => MCPCallToolResult>().mockReturnValue({
                content: [
                    {
                        type: "text",
                        text: `Mock implementation for tool: ${tool.name} is not implemented.`,
                    },
                ],
                isError: true,
            });
        }
    }

    listTools(): MCPTool[] {
        return this.tools;
    }

    callTool(toolName: string, ...parameters: unknown[]): MCPCallToolResult {
        return this.getMockedToolFn(toolName)(...parameters);
    }

    getMockedToolFn(toolName: string): ToolFnMock {
        const toolFn = this.toolFns[toolName];
        if (!toolFn) {
            throw new Error(`No tool registered with name ${toolName}`);
        }
        return toolFn;
    }

    resetMocks() {
        Object.entries(this.toolFns).forEach(([toolName, toolFn]) => {
            this.toolFns[toolName] = toolFn.mockReset().mockReturnValue({
                content: [
                    {
                        type: "text",
                        text: `Mock implementation for tool: ${toolName} is not implemented.`,
                    },
                ],
                isError: true,
            });
        });
    }
}
