import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";

import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import fs from "fs/promises";

export async function discoverMongoDBTools(): Promise<Tool[]> {
    let mcpClient: Client | undefined;
    try {
        const transport = new StdioClientTransport({
            command: "node",
            args: ["dist/index.js"],
        });

        mcpClient = new Client(
            {
                name: "tool-discovery-client",
                version: "0.0.0",
            },
            {
                capabilities: {},
            }
        );
        await mcpClient.connect(transport);

        return (await mcpClient.listTools()).tools;
    } finally {
        await mcpClient?.close();
    }
}

await fs.writeFile("mcp-tools.json", JSON.stringify(await discoverMongoDBTools(), null, 2));
