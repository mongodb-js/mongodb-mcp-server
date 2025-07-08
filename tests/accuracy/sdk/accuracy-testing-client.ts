import path from "path";
import { v4 as uuid } from "uuid";
import { fileURLToPath } from "url";
import { experimental_createMCPClient as createMCPClient, tool as createVercelTool } from "ai";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

import { ExpectedToolCall } from "./accuracy-snapshot-storage/snapshot-storage.js";

const __dirname = fileURLToPath(import.meta.url);
const distPath = path.join(__dirname, "..", "..", "..", "..", "dist");
const cliScriptPath = path.join(distPath, "index.js");

type ToolResultGeneratorFn = (...parameters: unknown[]) => CallToolResult | Promise<CallToolResult>;
export type MockedTools = Record<string, ToolResultGeneratorFn>;

export class AccuracyTestingClient {
    private mockedTools: MockedTools = {};
    private recordedToolCalls: ExpectedToolCall[] = [];
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
                    this.recordedToolCalls.push({
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
                        // and the schema definition check fails. Normally a
                        // tool calling agent will handle the error case but
                        // because we are wrapping the tool definition ourselves
                        // we have to handle this ourselves as well.
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

    getToolCalls() {
        return this.recordedToolCalls;
    }

    mockTools(mockedTools: MockedTools) {
        this.mockedTools = mockedTools;
    }

    resetForTests() {
        this.mockTools({});
        this.recordedToolCalls = [];
    }

    static async initializeClient(mdbConnectionString: string) {
        const clientTransport = new StdioClientTransport({
            command: process.execPath,
            args: [cliScriptPath, "--connectionString", mdbConnectionString],
        });

        const client = await createMCPClient({
            transport: clientTransport,
        });

        return new AccuracyTestingClient(client);
    }
}
