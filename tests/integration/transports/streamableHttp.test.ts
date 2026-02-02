import { StreamableHttpRunner } from "../../../src/transports/streamableHttp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import type { LoggerType, LogLevel, LogPayload } from "../../../src/common/logger.js";
import { LoggerBase, LogId } from "../../../src/common/logger.js";
import { createMCPConnectionManager } from "../../../src/common/connectionManager.js";
import { Keychain } from "../../../src/common/keychain.js";
import { defaultTestConfig } from "../helpers.js";
import { type UserConfig } from "../../../src/common/config/userConfig.js";

describe("StreamableHttpRunner", () => {
    let runner: StreamableHttpRunner;
    let config: UserConfig;

    beforeEach(() => {
        config = {
            ...defaultTestConfig,
            httpPort: 0, // Use a random port for testing
        };
    });

    const headerTestCases: { headers: Record<string, string>; description: string }[] = [
        { headers: {}, description: "without headers" },
        { headers: { "x-custom-header": "test-value" }, description: "with headers" },
    ];

    for (const { headers, description } of headerTestCases) {
        describe(description, () => {
            beforeEach(async () => {
                config.httpHeaders = headers;
                runner = new StreamableHttpRunner({ userConfig: config });
                await runner.start();
            });

            afterEach(async () => {
                await runner.close();
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
                    beforeEach(() => {
                        client = new Client({
                            name: "test",
                            version: "0.0.0",
                        });
                        transport = new StreamableHTTPClientTransport(
                            new URL(`${runner["mcpServer"]!.serverAddress}/mcp`),
                            {
                                requestInit: {
                                    headers: clientHeaders,
                                },
                            }
                        );
                    });

                    afterEach(async () => {
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
                                expect(err?.toString()).toContain("Error POSTing to endpoint");
                            }
                        }
                    });
                });
            }
        });
    }

    describe("with httpBodyLimit configuration", () => {
        it("should accept requests within the body limit", async () => {
            const testConfig = {
                ...defaultTestConfig,
                httpPort: 0,
                httpBodyLimit: 1024 * 1024,
            };
            const testRunner = new StreamableHttpRunner({ userConfig: testConfig });
            await testRunner.start();

            try {
                const client = new Client({
                    name: "test",
                    version: "0.0.0",
                });
                const transport = new StreamableHTTPClientTransport(
                    new URL(`${testRunner["mcpServer"]!.serverAddress}/mcp`)
                );

                await client.connect(transport);
                const response = await client.listTools();
                expect(response).toBeDefined();
                expect(response.tools).toBeDefined();

                await client.close();
                await transport.close();
            } finally {
                await testRunner.close();
            }
        });

        it("should reject requests exceeding the body limit", async () => {
            const testConfig = {
                ...defaultTestConfig,
                httpPort: 0,
                httpBodyLimit: 1024, // Very small limit (1kb)
            };
            const testRunner = new StreamableHttpRunner({ userConfig: testConfig });
            await testRunner.start();

            try {
                // Create a payload larger than 1kb
                const largePayload = JSON.stringify({
                    jsonrpc: "2.0",
                    method: "initialize",
                    id: 1,
                    params: {
                        protocolVersion: "2024-11-05",
                        capabilities: {},
                        clientInfo: {
                            name: "test",
                            version: "0.0.0",
                        },
                        // Add extra data to exceed 1kb
                        extraData: "x".repeat(2000),
                    },
                });

                const response = await fetch(`${testRunner["mcpServer"]!.serverAddress}/mcp`, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                    },
                    body: largePayload,
                });

                // Should return 413 Payload Too Large
                expect(response.status).toBe(413);
            } finally {
                await testRunner.close();
            }
        });
    });

    it("can create multiple runners", async () => {
        const runners: StreamableHttpRunner[] = [];
        try {
            for (let i = 0; i < 3; i++) {
                const runner = new StreamableHttpRunner({ userConfig: config });
                await runner.start();
                runners.push(runner);
            }

            const addresses = new Set<string>(runners.map((r) => r["mcpServer"]!.serverAddress));
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
            expect(serverStartedMessage?.payload.message).toContain("Streamable HTTP Transport started");
            expect(serverStartedMessage?.payload.context).toBe("streamableHttpTransport");
            expect(serverStartedMessage?.level).toBe("info");
        });
    });

    describe("with telemetry properties", () => {
        afterEach(async () => {
            await runner.close();
        });

        it("merges them with the base properties", async () => {
            config.telemetry = "enabled";
            runner = new StreamableHttpRunner({
                userConfig: config,
                telemetryProperties: { hosting_mode: "vscode-extension" },
            });
            await runner.start();

            const server = await runner["setupServer"]();
            const properties = server["telemetry"].getCommonProperties();
            expect(properties.hosting_mode).toBe("vscode-extension");
        });
    });

    describe("healthcheck", () => {
        beforeEach(() => {
            config = {
                ...config,
                transport: "http",
                healthCheckPort: 3001,
                healthCheckHost: "127.0.0.1",
            };
        });

        afterEach(async () => {
            await runner?.close();
        });

        it("starts the healthCheck server when configured", async () => {
            runner = new StreamableHttpRunner({ userConfig: config });
            await runner.start();

            expect(runner["healthCheckServer"]).toBeDefined();
            expect(runner["healthCheckServer"]!.serverAddress).toEqual("http://127.0.0.1:3001");
            const healthResponse = await fetch("http://localhost:3001/health");
            expect(healthResponse.status).toBe(200);
            const healthData = (await healthResponse.json()) as unknown;
            expect(healthData).toEqual({ status: "ok" });
        });

        it("does not start the healthCheck server when not configured", async () => {
            config.healthCheckHost = undefined;
            config.healthCheckPort = undefined;
            runner = new StreamableHttpRunner({ userConfig: config });
            await runner.start();

            expect(runner["healthCheckServer"]).toBeUndefined();
        });

        it("errors out when healthCheck port is missing but host is provided", async () => {
            config.healthCheckPort = undefined;
            runner = new StreamableHttpRunner({ userConfig: config });

            await expect(runner.start()).rejects.toThrowError();
        });

        it("errors out when healthCheck host is missing but port is provided", async () => {
            config.healthCheckHost = undefined;
            runner = new StreamableHttpRunner({ userConfig: config });

            await expect(runner.start()).rejects.toThrowError();
        });

        it("errors out when healthcheck port is equal to MCP server port", async () => {
            config.healthCheckPort = 3000;
            config.httpPort = 3000;
            runner = new StreamableHttpRunner({ userConfig: config });
            await expect(runner.start()).rejects.toThrowError();
        });
    });
});
