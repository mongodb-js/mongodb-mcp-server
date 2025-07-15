import { createHttpTransport } from "../../../src/transports/streamableHttp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { describe, expect, it, beforeAll, afterAll } from "vitest";
describe("streamableHttpTransport", () => {
    let transport: StreamableHTTPServerTransport;
    const mcpServer = new McpServer({
        name: "test",
        version: "1.0.0",
    });
    beforeAll(async () => {
        transport = await createHttpTransport();
        mcpServer.registerTool(
            "hello",
            {
                title: "Hello Tool",
                description: "Say hello",
                inputSchema: { name: z.string() },
            },
            ({ name }) => ({
                content: [{ type: "text", text: `Hello, ${name}!` }],
            })
        );
        await mcpServer.connect(transport);
    });

    afterAll(async () => {
        await mcpServer.close();
    });

    describe("client connects successfully", () => {
        let client: StreamableHTTPClientTransport;
        beforeAll(async () => {
            client = new StreamableHTTPClientTransport(new URL("http://127.0.0.1:3000/mcp"));
            await client.start();
        });

        afterAll(async () => {
            await client.close();
        });

        it("handles requests and sends responses", async () => {
            client.onmessage = (message: JSONRPCMessage) => {
                const messageResult = message as
                    | {
                          result?: {
                              tools: {
                                  name: string;
                                  description: string;
                              }[];
                          };
                      }
                    | undefined;

                expect(message.jsonrpc).toBe("2.0");
                expect(messageResult).toBeDefined();
                expect(messageResult?.result?.tools).toBeDefined();
                expect(messageResult?.result?.tools.length).toBe(1);
                expect(messageResult?.result?.tools[0]?.name).toBe("hello");
                expect(messageResult?.result?.tools[0]?.description).toBe("Say hello");
            };

            await client.send({
                jsonrpc: "2.0",
                id: 1,
                method: "tools/list",
                params: {
                    _meta: {
                        progressToken: 1,
                    },
                },
            });
        });
    });
});
