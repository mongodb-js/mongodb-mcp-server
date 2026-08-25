import path from "path";
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const currentDir = import.meta.dirname;
const projectRoot = path.resolve(currentDir, "../../../..");
const serverPath = path.resolve(projectRoot, "packages/mongodb-mcp-server/dist/esm/index.js");

describe("2026-07-28 protocol (modern era) over stdio", () => {
    let client: Client;
    let transport: StdioClientTransport;

    beforeAll(async () => {
        transport = new StdioClientTransport({
            command: "node",
            args: [serverPath, "--disabledTools", "atlas-local"],
            env: {
                MDB_MCP_TRANSPORT: "stdio",
                MDB_MCP_CONNECTION_STRING: "",
            },
        });
        client = new Client(
            {
                name: "test",
                version: "0.0.0",
            },
            { versionNegotiation: { mode: "auto" } }
        );
        await client.connect(transport);
    });

    afterAll(async () => {
        await client.close();
        await transport.close();
    });

    it("negotiates the modern era", () => {
        expect(client.getProtocolEra()).toBe("modern");
    });

    it("lists tools", async () => {
        const response = await client.listTools();
        expect(response.tools.length).toBeGreaterThan(0);
    });
});
