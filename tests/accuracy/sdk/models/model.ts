import { Tool as MCPTool } from "@modelcontextprotocol/sdk/types.js";
import { TestMCPClient } from "../test-mcp-client.js";

/**
 * Different model providers often have different SDKs to enable conversations
 * with their model. These SDKs works with different types of data.
 *
 * The Model interface below provide consistent and reliable methods for tests
 * to interact with model when needed.
 */
export interface Model<T extends object> {
    /**
     * Different model provider SDKS will have different tool definitions to be
     * provided when conversing with the model. This method is supposed to
     * transform a tool definition of type Tool(from modelcontextprotocol sdk),
     * which is what an MCP client reports back after discover, to the shape that
     * the model can consume.
     */
    transformMCPTool(tool: MCPTool): T;

    /**
     * Different model providers SDKs will have different ways to start a
     * conversation with the model. This method is supposed to abstract away
     * those details and provide a stable interface for our tests to work with.
     */
    chat(prompt: string, mcpClient: TestMCPClient): Promise<unknown[]>;
}
