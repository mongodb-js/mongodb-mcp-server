import path from "path";
import { v4 as uuid } from "uuid";
import { fileURLToPath } from "url";
import { experimental_createMCPClient as createMCPClient, tool as createVercelTool } from "ai";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

import { ToolCall } from "./accuracy-scorers.js";

const __dirname = fileURLToPath(import.meta.url);
const distPath = path.join(__dirname, "..", "..", "..", "..", "dist");
const cliScriptPath = path.join(distPath, "index.js");

type ToolResultGeneratorFn = (...parameters: unknown[]) => CallToolResult | Promise<CallToolResult>;
export type MockedTools = Record<string, ToolResultGeneratorFn>;

export class AccuracyTestingClient {
    private mockedTools: MockedTools = {};
    private recordedToolCalls: ToolCall[] = [];
    private constructor(private readonly client: Awaited<ReturnType<typeof createMCPClient>>) {}

    async close() {
        await this.client?.close();
    }

    async vercelTools() {
        const vercelTools = (await this.client?.tools()) ?? {};
        const rewrappedVercelTools: typeof vercelTools = {};
        for (const [toolName, tool] of Object.entries(vercelTools)) {
            rewrappedVercelTools[toolName] = createVercelTool({
                ...tool,
                execute: async (args, options) => {
                    this.recordedToolCalls.push({
                        toolCallId: uuid(),
                        toolName: toolName,
                        parameters: args,
                    });
                    const toolResultGeneratorFn = this.mockedTools[toolName];
                    if (toolResultGeneratorFn) {
                        return await toolResultGeneratorFn(args);
                    }

                    return tool.execute(args, options);
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
