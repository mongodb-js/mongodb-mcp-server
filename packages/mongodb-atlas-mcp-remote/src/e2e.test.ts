import { describe, it, expect, beforeAll, afterAll } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client, StdioClientTransport } from "@modelcontextprotocol/client";

/**
 * E2E tests are skipped unless Service Account credentials are set.
 */
const shouldSkip = !process.env.REMOTE_MCP_E2E_CLIENT_ID || !process.env.REMOTE_MCP_E2E_CLIENT_SECRET;

const CLI_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "dist", "cli.js");

describe.skipIf(shouldSkip)("mongodb-atlas-mcp-remote wrapper e2e tests", () => {
    let client: Client;

    beforeAll(async () => {
        client = new Client({ name: "e2e-test", version: "0.0.0" });
        const transport = new StdioClientTransport({
            command: process.execPath,
            args: [CLI_PATH],
            stderr: "pipe",
            env: {
                ...process.env,
                MDB_MCP_API_CLIENT_ID: process.env.REMOTE_MCP_E2E_CLIENT_ID ?? "",
                MDB_MCP_API_CLIENT_SECRET: process.env.REMOTE_MCP_E2E_CLIENT_SECRET ?? "",
                MDB_MCP_API_BASE_URL: process.env.REMOTE_MCP_E2E_BASE_URL ?? "",
            },
        });
        await client.connect(transport);
    }, 15_000);

    afterAll(async () => {
        await client?.close();
    });

    it("acquires a token and lists Atlas tools", async () => {
        const result = await client.listTools();
        expect(result.tools.map((t) => t.name)).toContain("atlas-list-projects");
    }, 10_000);

    it("calls atlas-list-projects and returns a non-error response", async () => {
        const result = await client.callTool({ name: "atlas-list-projects", arguments: {} });
        expect(result.isError).toBeFalsy();
        // Simple check to verify that the response content is forwarded.
        expect((result.content[0] as { text: string }).text).toContain("projects");
    }, 10_000);
});
