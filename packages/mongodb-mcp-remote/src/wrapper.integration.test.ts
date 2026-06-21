import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { startMockRemote, type MockRemote } from "./testHelpers/mockRemote.js";

/**
 * Integration tests for the mongodb-mcp-remote wrapper:
 *
 *
 *   ┌──────────────┐   stdio   ┌─────────────┐   HTTP   ┌──────────────────────┐
 *   │  MCP Client  │ ────────► │   WRAPPER   │ ───────► │  Remote MCP server   │
 *   │  (real, SDK) │ ◄──────── │ (under test)│ ◄─────── │  (MOCK)              │
 *   └──────────────┘           └─────────────┘          └──────────────────────┘
 *                                     │
 *                                     ▼
 *                            Token endpoint (MOCK)
 *
 * - LEFT: a real MCP SDK `Client` that starts the built wrapper as a child
 *   process and talks to it over stdin/stdout.
 * - RIGHT: a mock Express server that pretends to be mcp.mongodb.com and the
 *   Atlas token endpoint, so the tests need no real network and behave the same every run.
 *
 *  TODO: most tests here are `it.todo` until the wrapper implementation is complete in
 *  packages/mongodb-mcp-remote/src/. Tests will be implemented in MCP-539.
 */

const CLI_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "dist", "cli.js");

/**
 * Connects a real MCP SDK client by spawning the wrapper CLI against the mock remote.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- not called yet; the it.todo tests below will use it (remove once MCP-539 enables them)
async function connectClientToWrapper(remote: MockRemote): Promise<Client> {
    const client = new Client({ name: "integration-test", version: "0.0.0" });
    const transport = new StdioClientTransport({
        command: process.execPath, // node
        args: [CLI_PATH],
        env: {
            MDB_MCP_API_CLIENT_ID: "mock-id",
            MDB_MCP_API_CLIENT_SECRET: "mock-secret",
            MDB_MCP_API_BASE_URL: remote.url,
            MDB_MCP_REMOTE_URL: `${remote.url}/mcp`,
        },
    });
    await client.connect(transport);
    return client;
}

describe("mongodb-mcp-remote wrapper (integration)", () => {
    let remote: MockRemote;
    let client: Client | undefined;

    beforeEach(async () => {
        remote = await startMockRemote();
    });

    afterEach(async () => {
        await client?.close();
        client = undefined;
        await remote.close();
    });

    it("mock remote responds to token and mcp endpoints", async () => {
        // Checks the mock remote works on its own
        const tokenRes = await fetch(`${remote.url}/api/oauth/token`, { method: "POST" });
        expect(tokenRes.status).toBe(200);
        await expect(tokenRes.json()).resolves.toMatchObject({ access_token: "mock-token-123" });

        const unauthorized = await fetch(`${remote.url}/mcp`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
        });
        expect(unauthorized.status).toBe(401); // no bearer token → rejected
        expect(remote.tokenRequestCount()).toBe(1);
    });

    it.todo("forwards a tools/list request and attaches the bearer token to the remote call");
    // client = await connectClientToWrapper(remote);
    // const res = await client.listTools();
    // expect(res.tools.map((t) => t.name)).toContain("find");
    // expect(remote.lastAuthHeader()).toBe("Bearer mock-token-123");

    it.todo("reuses the cached token across multiple calls (token endpoint hit once)");
    // make two calls, then: expect(remote.tokenRequestCount()).toBe(1);

    it.todo("on 401 it refreshes the token and retries the request once");
    // client = await connectClientToWrapper(remote);
    // remote.failNextMcpCalls(1); const res = await client.listTools();
    // expect(res.tools.map((t) => t.name)).toContain("find");
    // expect(remote.tokenRequestCount()).toBeGreaterThanOrEqual(2);

    it.todo("fails fast with a clear error when credentials are rejected at startup");
    // point the token endpoint at a 401 and assert client.connect(...) rejects.

    it.todo("preserves the JSON-RPC request id on forwarded responses");

    it.todo("maps remote/network failures to distinct JSON-RPC error codes");
});
