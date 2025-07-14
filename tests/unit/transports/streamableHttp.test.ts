import { createHttpTransport } from "../../../src/transports/streamableHttp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import { config } from "../../../src/common/config.js";
import { z } from "zod";
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
            async ({ name }) => ({
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
                expect(message.jsonrpc).toBe("2.0");
                expect(message.result).toBeDefined();
                expect(message.result.tools).toBeDefined();
                expect(message.result.tools.length).toBe(1);
                expect(message.result.tools[0].name).toBe("hello");
                expect(message.result.tools[0].description).toBe("Say hello");
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
