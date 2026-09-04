import type express from "express";
import { StreamableHttpRunner } from "@mongodb-js/mcp-http-runners";
import { type LoggerBase, type AnyToolClass, CompositeLogger, Keychain, LogId } from "@mongodb-js/mcp-core";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { defaultTestConfig, InMemoryLogger } from "../integrationHelpers.js";
import {
    type UserConfig,
    type OperationType,
    type ToolArgs,
    type ToolCategory,
    type ToolExecutionContext,
    ToolBase,
    type CliServer,
} from "mongodb-mcp-server";
import { AllTools } from "mongodb-mcp-server";
import type { CallToolResult } from "@mongodb-js/mcp-types";
import type { TelemetryToolMetadata } from "@mongodb-js/mcp-atlas-telemetry";
import { PrometheusMetrics, createDefaultMetrics } from "@mongodb-js/mcp-metrics";
import {
    createStreamableHttpTestRunner,
    getServerAddress,
    TestMCPHttpServer,
} from "../helpers/streamableHttpTestRunner.js";

// Helper to create a StreamableHttpRunner with all components
async function createStreamableHttpRunner(
    config: UserConfig,
    options: {
        tools?: AnyToolClass[];
        loggers?: LoggerBase[];
    } = {}
): Promise<StreamableHttpRunner<CliServer>> {
    // `async` so that config validation errors thrown by the shared helper
    // surface as rejections, matching the pre-refactor behavior.
    return await Promise.resolve(createStreamableHttpTestRunner(config, options).runner);
}

const expectedHealthData: Record<string, unknown> = {
    status: "ok",
    version: expect.any(String) as unknown,
    uptimeSeconds: expect.any(Number) as unknown,
    timestamp: expect.any(String) as unknown,
};

describe("StreamableHttpRunner", () => {
    let runner: StreamableHttpRunner<CliServer>;
    let config: UserConfig;

    let clients: Client[] = [];

    const connectClient = async ({
        additionalHeaders = {},
    }: {
        additionalHeaders?: Record<string, string>;
    }): Promise<Client> => {
        const client = new Client({
            name: "test",
            version: "0.0.0",
        });

        const transport = new StreamableHTTPClientTransport(new URL(`${getServerAddress(runner)}/mcp`), {
            requestInit: {
                headers: additionalHeaders,
            },
        });

        await client.connect(transport);

        clients.push(client);
        return client;
    };

    beforeEach(() => {
        config = {
            ...defaultTestConfig,
            httpPort: 0, // Use a random port for testing
        };
    });

    afterEach(async () => {
        for (const client of clients) {
            await client.close();
        }
        clients = [];

        await runner?.close();
        // Make sure runner is reset
        runner = undefined as unknown as StreamableHttpRunner<CliServer>;
    });

    const headerTestCases: { headers: Record<string, string>; description: string }[] = [
        { headers: {}, description: "without headers" },
        { headers: { "x-custom-header": "test-value" }, description: "with headers" },
    ];

    for (const { headers, description } of headerTestCases) {
        describe(description, () => {
            beforeEach(async () => {
                config.httpHeaders = headers;
                runner = await createStreamableHttpRunner(config);
                await runner.start();
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
                        transport = new StreamableHTTPClientTransport(new URL(`${getServerAddress(runner)}/mcp`), {
                            requestInit: {
                                headers: clientHeaders,
                            },
                        });
                    });

                    afterEach(async () => {
                        await client.close();
                        await transport.close();
                    });

                    it(`should ${expectSuccess ? "succeed" : "fail"}`, async () => {
                        try {
                            const client = await connectClient({ additionalHeaders: clientHeaders });
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
        beforeEach(async () => {
            config.httpBodyLimit = 1024;
            runner = await createStreamableHttpRunner(config);
            await runner.start();
        });

        it("should accept requests within the body limit", async () => {
            const client = await connectClient({});
            const response = await client.listTools();
            expect(response).toBeDefined();
            expect(response.tools).toBeDefined();
        });

        it("should reject requests exceeding the body limit", async () => {
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

            const response = await fetch(`${getServerAddress(runner)}/mcp`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: largePayload,
            });

            // Should return 413 Payload Too Large
            expect(response.status).toBe(413);
        });
    });

    it("can create multiple runners", async () => {
        const runners: StreamableHttpRunner<CliServer>[] = [];
        try {
            for (let i = 0; i < 3; i++) {
                const runner = await createStreamableHttpRunner(config);
                await runner.start();
                runners.push(runner);
            }

            const addresses = new Set<string>(runners.map((r) => getServerAddress(r)));
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

        it("can provide custom logger", async () => {
            const logger = new InMemoryLogger({ keychain: new Keychain() });
            runner = await createStreamableHttpRunner(config, { loggers: [logger] });
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

    const sendHttpRequest = async (
        method: "initialize" | "tools/list",
        additionalHeaders: Record<string, string> = {}
    ): Promise<Response> => {
        const headers: Record<string, string> = {
            "Content-Type": "application/json",
            accept: "application/json, text/event-stream",
            ...additionalHeaders,
        };

        const response = await fetch(`${getServerAddress(runner)}/mcp`, {
            method: "POST",
            headers,
            body: JSON.stringify({
                jsonrpc: "2.0",
                method: method,
                id: 1,
                params:
                    method === "initialize"
                        ? {
                              protocolVersion: "2024-11-05",
                              capabilities: {},
                              clientInfo: {
                                  name: "test",
                                  version: "0.0.0",
                              },
                          }
                        : undefined,
            }),
        });

        return response;
    };

    describe("2025-era stateless fallback", () => {
        beforeEach(async () => {
            runner = await createStreamableHttpRunner(config);
            await runner.start();
        });

        it("should serve an initialize request without a session ID", async () => {
            const response = await sendHttpRequest("initialize");

            expect(response.ok).toBe(true);
            // Stateless serving never returns an `mcp-session-id` header.
            expect(response.headers.get("mcp-session-id")).toBeNull();
        });

        it("should return SSE responses for 2025-era requests", async () => {
            const response = await sendHttpRequest("initialize");

            expect(response.ok).toBe(true);
            expect(response.headers.get("content-type")).toContain("text/event-stream");
            expect(response.headers.get("content-type")).not.toContain("application/json");

            const data = await response.text();
            expect(data).toContain("event: message");
            expect(data).toContain("data: ");
        });

        it("should serve a non-initialize request without a session ID", async () => {
            // The stateless fallback (`sessionIdGenerator: undefined`) does not
            // validate `mcp-session-id`, so claim-less requests succeed without one.
            const response = await sendHttpRequest("tools/list");
            expect(response.ok).toBe(true);
        });
    });

    describe("createMcpHttpServer factory", () => {
        it("should use custom MCPHttpServer subclass via factory", async () => {
            const middlewareCalls: string[] = [];

            class CustomTestMCPHttpServer extends TestMCPHttpServer {
                protected override async setupRoutes(): Promise<void> {
                    this.app.use((_req: express.Request, _res: express.Response, next: express.NextFunction) => {
                        middlewareCalls.push("middleware-executed");
                        next();
                    });
                    await super.setupRoutes();
                }
            }

            // Create runner with custom MCPHttpServer
            const logger = new CompositeLogger({ loggers: [] });
            const metrics = new PrometheusMetrics({ definitions: createDefaultMetrics() });

            const customMcpHttpServer = new CustomTestMCPHttpServer({
                userConfig: config,
                options: {
                    http: {
                        host: config.httpHost,
                        port: config.httpPort,
                        bodyLimit: config.httpBodyLimit,
                        headers: config.httpHeaders,
                        responseType: config.httpResponseType,
                        authMode: "unauthenticated",
                    },
                },
                logger,
                metrics,
                tools: AllTools,
            });

            runner = new StreamableHttpRunner<CliServer>({
                mcpHttpServer: customMcpHttpServer,
                logger,
            });

            await runner.start();

            const client = await connectClient({});
            const response = await client.listTools();
            expect(response).toBeDefined();
            expect(response.tools).toBeDefined();
            expect(middlewareCalls.length).toBeGreaterThanOrEqual(1);
        });

        it("should allow factory to create a server that rejects requests", async () => {
            class RejectingMCPHttpServer extends TestMCPHttpServer {
                protected override async setupRoutes(): Promise<void> {
                    this.app.use((_req: express.Request, res: express.Response) => {
                        res.status(403).json({ error: "blocked by middleware" });
                    });
                    await super.setupRoutes();
                }
            }

            // Create runner with rejecting MCPHttpServer
            const logger = new CompositeLogger({ loggers: [] });
            const metrics = new PrometheusMetrics({ definitions: createDefaultMetrics() });

            const rejectingMcpHttpServer = new RejectingMCPHttpServer({
                userConfig: config,
                options: {
                    http: {
                        host: config.httpHost,
                        port: config.httpPort,
                        bodyLimit: config.httpBodyLimit,
                        headers: config.httpHeaders,
                        responseType: config.httpResponseType,
                        authMode: "unauthenticated",
                    },
                },
                logger,
                metrics,
                tools: AllTools,
            });

            runner = new StreamableHttpRunner<CliServer>({
                mcpHttpServer: rejectingMcpHttpServer,
                logger,
            });

            await runner.start();

            const response = await fetch(`${getServerAddress(runner)}/mcp`, {
                method: "POST",
                headers: { "Content-Type": "application/json", accept: "application/json, text/event-stream" },
                body: JSON.stringify({
                    jsonrpc: "2.0",
                    method: "initialize",
                    id: 1,
                    params: {
                        protocolVersion: "2024-11-05",
                        capabilities: {},
                        clientInfo: { name: "test", version: "0.0.0" },
                    },
                }),
            });

            expect(response.status).toBe(403);
            const data = (await response.json()) as { error?: string };
            expect(data.error).toBe("blocked by middleware");
        });

        it("should work without custom factory (default behavior)", async () => {
            runner = await createStreamableHttpRunner(config);
            await runner.start();

            const client = await connectClient({});
            const response = await client.listTools();
            expect(response).toBeDefined();
            expect(response.tools.length).toBeGreaterThan(0);
        });
    });

    describe("monitoring server", () => {
        describe("using legacy healthCheck config (backwards compat)", () => {
            beforeEach(() => {
                config = {
                    ...config,
                    transport: "http",
                    healthCheckPort: 3001,
                    healthCheckHost: "127.0.0.1",
                };
            });

            it("starts the monitoring server when configured", async () => {
                runner = await createStreamableHttpRunner(config);
                await runner.start();

                expect(runner["monitoringServer"]).toBeDefined();
                expect(runner["monitoringServer"]!.serverAddress).toEqual("http://127.0.0.1:3001");
                const healthResponse = await fetch("http://localhost:3001/health");
                expect(healthResponse.status).toBe(200);
                const healthData = (await healthResponse.json()) as unknown;
                expect(healthData).toEqual(expectedHealthData);
            });

            it("does not start the monitoring server when not configured", async () => {
                config.healthCheckHost = undefined;
                config.healthCheckPort = undefined;
                runner = await createStreamableHttpRunner(config);
                await runner.start();

                expect(runner["monitoringServer"]).toBeUndefined();
            });

            it("errors out when healthCheck port is missing but host is provided", async () => {
                config.healthCheckPort = undefined;

                await expect(createStreamableHttpRunner(config)).rejects.toThrowError();
            });

            it("errors out when healthCheck host is missing but port is provided", async () => {
                config.healthCheckHost = undefined;

                await expect(createStreamableHttpRunner(config)).rejects.toThrowError();
            });

            it("errors out when healthcheck port is equal to MCP server port", async () => {
                config.healthCheckPort = 3000;
                config.httpPort = 3000;
                runner = await createStreamableHttpRunner(config);
                await expect(runner.start()).rejects.toThrowError();
            });

            it("handles correctly when healthCheckPort is set to 0", async () => {
                config.httpPort = 3000;
                config.healthCheckPort = 0;
                runner = await createStreamableHttpRunner(config);
                await runner.start();

                expect(runner["monitoringServer"]).toBeDefined();
                const healthResponse = await fetch(`${runner["monitoringServer"]!.serverAddress}/health`);
                expect(healthResponse.status).toBe(200);
                const healthData = (await healthResponse.json()) as unknown;
                expect(healthData).toEqual(expectedHealthData);
            });
        });

        describe("using monitoringServer config", () => {
            beforeEach(() => {
                config = {
                    ...config,
                    transport: "http",
                    monitoringServerPort: 3001,
                    monitoringServerHost: "127.0.0.1",
                };
            });

            it("starts the monitoring server and exposes /health by default", async () => {
                runner = await createStreamableHttpRunner(config);
                await runner.start();

                expect(runner["monitoringServer"]).toBeDefined();
                expect(runner["monitoringServer"]!.serverAddress).toEqual("http://127.0.0.1:3001");
                const healthResponse = await fetch("http://localhost:3001/health");
                expect(healthResponse.status).toBe(200);
                const healthData = (await healthResponse.json()) as unknown;
                expect(healthData).toEqual(expectedHealthData);
            });

            it("does not start the monitoring server when not configured", async () => {
                config.monitoringServerHost = undefined;
                config.monitoringServerPort = undefined;
                runner = await createStreamableHttpRunner(config);
                await runner.start();

                expect(runner["monitoringServer"]).toBeUndefined();
            });

            it("errors out when monitoringServerPort is missing but host is provided", async () => {
                config.monitoringServerPort = undefined;

                await expect(createStreamableHttpRunner(config)).rejects.toThrowError();
            });

            it("errors out when monitoringServerHost is missing but port is provided", async () => {
                config.monitoringServerHost = undefined;

                await expect(createStreamableHttpRunner(config)).rejects.toThrowError();
            });

            it("errors out when monitoringServerPort is equal to MCP server port", async () => {
                config.monitoringServerPort = 3000;
                config.httpPort = 3000;
                runner = await createStreamableHttpRunner(config);
                await expect(runner.start()).rejects.toThrowError();
            });

            it("does not expose /metrics when features does not include 'metrics'", async () => {
                config.monitoringServerFeatures = ["health-check"];
                runner = await createStreamableHttpRunner(config);
                await runner.start();

                const metricsResponse = await fetch("http://localhost:3001/metrics");
                expect(metricsResponse.status).toBe(404);
            });

            it("exposes /metrics when features includes 'metrics'", async () => {
                config.monitoringServerFeatures = ["health-check", "metrics"];
                runner = await createStreamableHttpRunner(config);
                await runner.start();

                const metricsResponse = await fetch("http://localhost:3001/metrics");
                expect(metricsResponse.status).toBe(200);
                expect(metricsResponse.headers.get("content-type")).toMatch(/text\/plain/);
            });
        });
    });

    it("should pass the request headers as part of tool execution context", async () => {
        let confirmRequestReceived: ((request: ToolExecutionContext["request"]) => void) | undefined;
        const requestReceived = new Promise<ToolExecutionContext["request"]>((resolve) => {
            confirmRequestReceived = resolve;
        });

        class RandomTool extends ToolBase {
            static toolName = "random-tool";
            public description = "Random tool";
            public argsShape = {};
            static category: ToolCategory = "mongodb";
            static operationType: OperationType = "metadata";
            protected execute(
                _: ToolArgs<typeof this.argsShape>,
                { request }: ToolExecutionContext
            ): Promise<CallToolResult> {
                confirmRequestReceived?.(request);
                return Promise.resolve({
                    content: [
                        {
                            type: "text",
                            text: "Tool executed",
                        },
                    ],
                });
            }
            protected resolveTelemetryMetadata(): TelemetryToolMetadata {
                return {};
            }
        }

        runner = await createStreamableHttpRunner(config, { tools: [RandomTool] });
        await runner.start();

        const client = await connectClient({ additionalHeaders: { Authorization: "Bearer 1234" } });
        const response = await client.listTools();
        expect(response).toBeDefined();
        expect(response.tools).toBeDefined();
        expect(response.tools.length).toBe(1);

        await client.callTool({
            name: "random-tool",
            arguments: {},
        });
        const request = await requestReceived;
        expect(request).toBeDefined();
        const authorizationToken = request?.headers?.["authorization"] ?? request?.headers?.["Authorization"];
        expect(authorizationToken).toBe("Bearer 1234");
    });
});
