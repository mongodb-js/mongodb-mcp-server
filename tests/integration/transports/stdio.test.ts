import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { describeWithMongoDB } from "../tools/mongodb/mongodbHelpers.js";

describeWithMongoDB("StdioRunner", (integration) => {
    describe("client connects successfully", () => {
        let client: Client;
        let transport: StdioClientTransport;
        beforeAll(async () => {
            transport = new StdioClientTransport({
                command: "node",
                args: ["dist/index.js"],
                env: {
                    MDB_MCP_TRANSPORT: "stdio",
                    MDB_MCP_CONNECTION_STRING: integration.connectionString(),
                },
            });
            client = new Client({
                name: "test",
                version: "0.0.0",
            });
            await client.connect(transport);
        });

        afterAll(async () => {
            await client.close();
            await transport.close();
        });

        it("handles requests and sends responses", async () => {
            const response = await client.listTools();
            expect(response).toBeDefined();
            expect(response.tools).toBeDefined();
            expect(response.tools).toHaveLength(20);

            const sortedTools = response.tools.sort((a, b) => a.name.localeCompare(b.name));
            expect(sortedTools[0]?.name).toBe("aggregate");
            expect(sortedTools[0]?.description).toBe("Run an aggregation against a MongoDB collection");
        });
    });
});
