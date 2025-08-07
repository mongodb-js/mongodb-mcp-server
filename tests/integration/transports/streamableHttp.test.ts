import { StreamableHttpRunner } from "../../../src/transports/streamableHttp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { config } from "../../../src/common/config.js";

describe("StreamableHttpRunner", () => {
    let runner: StreamableHttpRunner;
    let oldTelemetry: "enabled" | "disabled";
    let oldLoggers: ("stderr" | "disk" | "mcp")[];

    beforeAll(async () => {
        oldTelemetry = config.telemetry;
        oldLoggers = config.loggers;
        config.telemetry = "disabled";
        config.loggers = ["stderr"];
        runner = new StreamableHttpRunner(config);
        await runner.start();
    });

    afterAll(async () => {
        await runner.close();
        config.telemetry = oldTelemetry;
        config.loggers = oldLoggers;
    });

    describe("client connects successfully", () => {
        let client: Client;
        let transport: StreamableHTTPClientTransport;
        beforeAll(async () => {
            transport = new StreamableHTTPClientTransport(new URL("http://127.0.0.1:3000/mcp"));

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
            expect(response.tools.length).toBeGreaterThan(0);

            const sortedTools = response.tools.sort((a, b) => a.name.localeCompare(b.name));
            expect(sortedTools[0]?.name).toBe("aggregate");
            expect(sortedTools[0]?.description).toBe("Run an aggregation against a MongoDB collection");
        });
    });
});
