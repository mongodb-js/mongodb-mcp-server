import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { startFakeRemote, type FakeRemote } from "./testHelpers/fakeRemote.js";

/**
 * Integration tests for the mongodb-mcp-remote wrapper.
 *
 * Shape of the world under test (see README / 1-pager MCP-436):
 *
 *   ┌──────────────┐   stdio   ┌─────────────┐   HTTP   ┌──────────────────────┐
 *   │  MCP Client  │ ────────► │   WRAPPER   │ ───────► │  Remote MCP server   │
 *   │  (real, SDK) │ ◄──────── │ (under test)│ ◄─────── │  (FAKE, built below) │
 *   └──────────────┘           └─────────────┘          └──────────────────────┘
 *                                     │
 *                                     ▼
 *                            Token endpoint (FAKE)
 *
 * - LEFT  end: a real MCP SDK `Client` over `StdioClientTransport`, which spawns
 *   the built wrapper CLI as a child process and speaks MCP over its stdin/stdout.
 * - RIGHT end: a fake Express server standing in for mcp.mongodb.com AND the Atlas
 *   token endpoint, so the test is fully offline and deterministic.
 *
 * NOTE: most tests are `it.todo` until packages/mongodb-mcp-remote/src/cli.ts is
 * implemented. The fake-remote scaffold below is live and exercised by the
 * "fake remote scaffold" sanity test so the harness is proven before the wrapper
 * exists.
 */

// Path to the built wrapper CLI this package produces. The wrapper must be compiled
// before these tests run, since StdioClientTransport spawns dist/cli.js as a child process.
const CLI_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "dist", "cli.js");

/**
 * Connects a real MCP SDK client by spawning the wrapper CLI against the fake remote.
 * Used by the (currently `it.todo`) scenarios below; kept ready for MCP-539.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function connectClientToWrapper(remote: FakeRemote): Promise<Client> {
    const client = new Client({ name: "integration-test", version: "0.0.0" });
    const transport = new StdioClientTransport({
        command: process.execPath, // node
        args: [CLI_PATH],
        env: {
            // Env var names per the 1-pager (MCP-436). Adjust if finalized differently.
            MDB_MCP_API_CLIENT_ID: "fake-id",
            MDB_MCP_API_CLIENT_SECRET: "fake-secret",
            MDB_MCP_API_BASE_URL: remote.url, // token calls go here
            MDB_MCP_REMOTE_URL: `${remote.url}/mcp`, // MCP calls go here
        },
    });
    await client.connect(transport);
    return client;
}

describe("mongodb-mcp-remote wrapper (integration)", () => {
    let remote: FakeRemote;
    let client: Client | undefined;

    beforeEach(async () => {
        remote = await startFakeRemote();
    });

    afterEach(async () => {
        await client?.close();
        client = undefined;
        await remote.close();
    });

    it("fake remote scaffold responds to token and mcp endpoints", async () => {
        // Sanity check that the harness itself works, independent of the wrapper.
        const tokenRes = await fetch(`${remote.url}/api/oauth/token`, { method: "POST" });
        expect(tokenRes.status).toBe(200);
        await expect(tokenRes.json()).resolves.toMatchObject({ access_token: "fake-token-123" });

        const unauthorized = await fetch(`${remote.url}/mcp`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
        });
        expect(unauthorized.status).toBe(401); // no bearer token → rejected
        expect(remote.tokenRequestCount()).toBe(1);
    });

    // ── Wrapper behaviors to implement once src/cli.ts exists ───────────────────
    // Each becomes a real test by replacing `it.todo(...)` with an `it(..., async () => {...})`
    // that uses connectClientToWrapper(remote) and asserts on the fake remote's spies.
    it.todo("forwards a tools/list request and attaches the bearer token to the remote call");
    // client = await connectClientToWrapper(remote);
    // const res = await client.listTools();
    // expect(res.tools.map((t) => t.name)).toContain("find");
    // expect(remote.lastAuthHeader()).toBe("Bearer fake-token-123");

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
