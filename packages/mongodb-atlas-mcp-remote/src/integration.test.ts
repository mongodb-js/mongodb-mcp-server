import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client, StdioClientTransport } from "@modelcontextprotocol/client";
import { MockRemote } from "./testHelpers/mockRemote.js";

/**
 * Integration tests for the mongodb-atlas-mcp-remote wrapper.
 *
 * Each test runs an MCP Client that starts dist/cli.js as a child process.
 * Tests run fully offline, the remote MCP server and Atlas token endpoint are mocked using testHelpers/mockRemote.ts.
 * Tests run sequentially - they share the same mock server instance.
 */

const CLI_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "dist", "cli.js");

async function createTestClient(
    remote: MockRemote,
    onTransport?: (t: StdioClientTransport) => void // hook for reading stderr
): Promise<Client> {
    const client = new Client({ name: "integration-test", version: "0.0.0" });
    const transport = new StdioClientTransport({
        command: process.execPath,
        args: [CLI_PATH],
        stderr: "pipe",
        env: {
            MDB_MCP_API_CLIENT_ID: "mock-id",
            MDB_MCP_API_CLIENT_SECRET: "mock-secret",
            MDB_MCP_API_BASE_URL: remote.url,
        },
    });
    onTransport?.(transport);
    await client.connect(transport);
    return client;
}

describe("mongodb-atlas-mcp-remote integration tests", () => {
    let remote: MockRemote;
    let client: Client | undefined;

    beforeAll(async () => {
        remote = await MockRemote.start();
    });

    afterAll(async () => {
        await remote.close();
    });

    afterEach(async () => {
        await client?.close();
        client = undefined;
        remote.reset();
    });

    // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
    function callTool(name: string, args: Record<string, unknown> = {}) {
        return client!.callTool({ name, arguments: args });
    }

    for (const mode of ["sse", "json"] as const) {
        it(`[${mode}] forwards tools/list and returns the response`, async () => {
            remote.setResponseMode(mode);
            client = await createTestClient(remote);
            const result = await client.listTools();
            expect(result.tools.map((t) => t.name)).toContain("mock-project-tool");
        });

        it(`[${mode}] calls a tool and returns the result`, async () => {
            remote.setResponseMode(mode);
            client = await createTestClient(remote);
            const result = await callTool("mock-project-tool", { projectId: "proj-1" });
            expect(result.content).toMatchObject([{ type: "text", text: "Mock result for mock-project-tool" }]);
        });

        it(`[${mode}] calls a tool with bad params and returns the error`, async () => {
            remote.setResponseMode(mode);
            client = await createTestClient(remote);
            const result = await callTool("mock-project-tool");
            expect(result.isError).toBe(true);
            expect(result.content).toMatchObject([{ type: "text", text: "Missing required argument: projectId" }]);
        });
    }

    it("reuses the cached token across multiple calls", async () => {
        client = await createTestClient(remote);
        const result1 = await callTool("mock-project-tool", { projectId: "proj-1" });
        const result2 = await callTool("mock-project-tool", { projectId: "proj-2" });
        expect(result1.isError).toBeFalsy();
        expect(result2.isError).toBeFalsy();
        expect(remote.getTokenRequestCount()).toBe(1);
    });

    it("fails fast when the token endpoint rejects at startup", async () => {
        remote.failNextTokenRequest();
        let stderrOutput = "";
        await expect(
            createTestClient(remote, (t) => t.stderr?.on("data", (s) => (stderrOutput += s)))
        ).rejects.toThrow();
        expect(stderrOutput).toContain("Failed to acquire access token");
    });

    it("refreshes the token and retries on 401 from tool calls", async () => {
        client = await createTestClient(remote);
        remote.invalidateToken(); // Server fails the first tool call since the initial token is no longer valid.
        const result = await callTool("mock-project-tool", { projectId: "proj-1" });
        expect(result.isError).toBeFalsy();
        expect(remote.getTokenRequestCount()).toBe(2);
    });

    it("re-initializes and retries when the remote session expires", async () => {
        client = await createTestClient(remote);
        remote.currentSessionId = undefined; // Server discards the session, next tool call gets a 404.
        const result = await callTool("mock-project-tool", { projectId: "proj-1" });
        expect(result.isError).toBeFalsy();
        expect(result.content).toMatchObject([{ type: "text", text: "Mock result for mock-project-tool" }]);
        expect(remote.getInitializeCount()).toBe(2);
    });
});
