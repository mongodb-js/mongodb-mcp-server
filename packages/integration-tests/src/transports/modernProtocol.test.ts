import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import type { StreamableHttpRunner } from "@mongodb-js/mcp-http-runners";
import type { CliServer } from "mongodb-mcp-server";
import { defaultTestConfig } from "../integrationHelpers.js";
import { createStreamableHttpTestRunner, getServerAddress } from "../helpers/streamableHttpTestRunner.js";

describe("2026-07-28 protocol (modern era) over HTTP", () => {
    let runner: StreamableHttpRunner<CliServer>;
    let client: Client;
    let transport: StreamableHTTPClientTransport;

    beforeAll(async () => {
        // Random port: other suites bind the default httpPort (3000), and
        // vitest runs test files in parallel workers.
        ({ runner } = createStreamableHttpTestRunner({ ...defaultTestConfig, httpPort: 0 }));
        await runner.start();

        transport = new StreamableHTTPClientTransport(new URL(`${getServerAddress(runner)}/mcp`), {});
        client = new Client(
            { name: "modern-test", version: "1.0.0" },
            { versionNegotiation: { mode: "auto" }, capabilities: { elicitation: {} } }
        );
        await client.connect(transport);
    });

    afterAll(async () => {
        await client?.close();
        await transport?.close();
        await runner?.close();
    });

    it("negotiates the modern era", () => {
        expect(client.getProtocolEra()).toBe("modern");
    });

    it("lists tools", async () => {
        const { tools } = await client.listTools();
        expect(tools.length).toBeGreaterThan(0);
        expect(tools.map((t) => t.name)).toContain("aggregate");
    });
});
