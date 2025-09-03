import { StreamableHttpRunner } from "../../../src/transports/streamableHttp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { describe, expect, it, beforeAll, afterAll, beforeEach } from "vitest";
import { config } from "../../../src/common/config.js";
import type { LoggerType, LogLevel, LogPayload } from "../../../src/common/logger.js";
import { LoggerBase, LogId } from "../../../src/common/logger.js";
import { createMCPConnectionManager } from "../../../src/common/connectionManager.js";
import { Keychain } from "../../../src/common/keychain.js";

describe("StreamableHttpRunner", () => {
    let runner: StreamableHttpRunner;
    let oldTelemetry: "enabled" | "disabled";
    let oldLoggers: ("stderr" | "disk" | "mcp")[];

    beforeAll(() => {
        oldTelemetry = config.telemetry;
        oldLoggers = config.loggers;
        config.telemetry = "disabled";
        config.loggers = ["stderr"];
        config.httpPort = 0; // Use a random port for testing
    });

    const headerTestCases: { headers: Record<string, string>; description: string }[] = [
        { headers: {}, description: "without headers" },
        { headers: { "x-custom-header": "test-value" }, description: "with headers" },
    ];

    for (const { headers, description } of headerTestCases) {
        describe(description, () => {
            beforeAll(async () => {
                config.httpHeaders = headers;
                runner = new StreamableHttpRunner({ userConfig: config });
                await runner.start();
            });

            afterAll(async () => {
                await runner.close();
                config.telemetry = oldTelemetry;
                config.loggers = oldLoggers;
                config.httpHeaders = {};
            });

            const clientHeaderTestCases = [
                {
                    headers: {},
                    description: "without client headers",
                    expectSuccess: Object.keys(headers).length === 0,
                },
                { headers, description: "with matching client headers", expectSuccess: true },
                { headers: { ...headers, foo: "bar" }, description: "with extra client headers", expectSuccess: true },
                {
                    headers: { foo: "bar" },
                    description: "with non-matching client headers",
                    expectSuccess: Object.keys(headers).length === 0,
                },
            ];

            for (const {
                headers: clientHeaders,
                description: clientDescription,
                expectSuccess,
            } of clientHeaderTestCases) {
                describe(clientDescription, () => {
                    let client: Client;
                    let transport: StreamableHTTPClientTransport;
                    beforeAll(() => {
                        client = new Client({
                            name: "test",
                            version: "0.0.0",
                        });
                        transport = new StreamableHTTPClientTransport(new URL(`${runner.serverAddress}/mcp`), {
                            requestInit: {
                                headers: clientHeaders,
                            },
                        });
                    });

                    afterAll(async () => {
                        await client.close();
                        await transport.close();
                    });

                    it(`should ${expectSuccess ? "succeed" : "fail"}`, async () => {
                        try {
                            await client.connect(transport);
                            const response = await client.listTools();
                            expect(response).toBeDefined();
                            expect(response.tools).toBeDefined();
                            expect(response.tools.length).toBeGreaterThan(0);

                            const sortedTools = response.tools.sort((a, b) => a.name.localeCompare(b.name));
                            expect(sortedTools[0]?.name).toBe("aggregate");
                            expect(sortedTools[0]?.description).toBe("Run an aggregation against a MongoDB collection");
                        } catch (err) {
                            if (expectSuccess) {
                                throw err;
                            } else {
                                expect(err).toBeDefined();
                                expect(err?.toString()).toContain("HTTP 403");
                            }
                        }
                    });
                });
            }
        });
    }

    it("can create multiple runners", async () => {
        const runners: StreamableHttpRunner[] = [];
        try {
            for (let i = 0; i < 3; i++) {
                config.httpPort = 0; // Use a random port for each runner
                const runner = new StreamableHttpRunner({ userConfig: config });
                await runner.start();
                runners.push(runner);
            }

            const addresses = new Set<string>(runners.map((r) => r.serverAddress));
            expect(addresses.size).toBe(runners.length);
        } finally {
            for (const runner of runners) {
                await runner.close();
            }
        }
    });

    describe("with custom logger", () => {
        beforeEach(() => {
            config.loggers = [];
        });

        class CustomLogger extends LoggerBase {
            protected type?: LoggerType = "console";
            public messages: { level: LogLevel; payload: LogPayload }[] = [];
            protected logCore(level: LogLevel, payload: LogPayload): void {
                this.messages.push({ level, payload });
            }
        }

        it("can provide custom logger", async () => {
            const logger = new CustomLogger(new Keychain());
            const runner = new StreamableHttpRunner({
                userConfig: config,
                createConnectionManager: createMCPConnectionManager,
                additionalLoggers: [logger],
            });
            await runner.start();

            const messages = logger.messages;
            expect(messages.length).toBeGreaterThan(0);

            const serverStartedMessage = messages.filter(
                (m) => m.payload.id === LogId.streamableHttpTransportStarted
            )[0];
            expect(serverStartedMessage).toBeDefined();
            expect(serverStartedMessage?.payload.message).toContain("Server started on");
            expect(serverStartedMessage?.payload.context).toBe("streamableHttpTransport");
            expect(serverStartedMessage?.level).toBe("info");
        });
    });
});
