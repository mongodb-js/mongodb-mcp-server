import { StreamableHttpRunner } from "../../../src/transports/streamableHttp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { LogId } from "../../../src/common/logger.js";
import { createMCPConnectionManager } from "../../../src/common/connectionManager.js";
import { Keychain } from "../../../src/common/keychain.js";
import { defaultTestConfig, InMemoryLogger, timeout } from "../helpers.js";
import { type UserConfig } from "../../../src/common/config/userConfig.js";
import type { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { OperationType, ToolArgs, ToolCategory, ToolExecutionContext } from "../../../src/tools/tool.js";
import { ToolBase } from "../../../src/tools/tool.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { TelemetryToolMetadata } from "../../../src/telemetry/types.js";

describe("StreamableHttpRunner", () => {
    let runner: StreamableHttpRunner;
    let config: UserConfig;

    let clients: Client[] = [];

    const connectClient = async ({
        sessionId = undefined,
        shouldInitialize = true,
        additionalHeaders = {},
    }: {
        sessionId?: string;
        shouldInitialize?: boolean;
        additionalHeaders?: Record<string, string>;
    }): Promise<Client> => {
        const client = new Client({
            name: "test",
            version: "0.0.0",
        });

        const requestHeaders: Record<string, string> = {
            ...additionalHeaders,
        };
        if (sessionId) {
            requestHeaders["mcp-session-id"] = sessionId;
        }

        const transport = new StreamableHTTPClientTransport(new URL(`${runner["mcpServer"]!.serverAddress}/mcp`), {
            requestInit: {
                headers: requestHeaders,
            },
            // If `sessionId` is set, the client will skip the initialize request.
            // If we want to ensure the initialization request is sent, we set `sessionId` to undefined,
            // even if we have an external session ID to use.
            sessionId: shouldInitialize ? undefined : sessionId,
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
        runner = undefined as unknown as StreamableHttpRunner;
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
            runner = new StreamableHttpRunner({ userConfig: config });
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

            const response = await fetch(`${runner["mcpServer"]!.serverAddress}/mcp`, {
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

        it("can provide custom logger", async () => {
            const logger = new InMemoryLogger(new Keychain());
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

    const sendHttpRequest = async (method: "initialize" | "tools/list", sessionId?: string): Promise<Response> => {
        const headers: Record<string, string> = {
            "Content-Type": "application/json",
            accept: "application/json, text/event-stream",
        };
        if (sessionId) {
            headers["mcp-session-id"] = sessionId;
        }

        const response = await fetch(`${runner["mcpServer"]!.serverAddress}/mcp`, {
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

    const getSessionFromStore = (sessionId: string): StreamableHTTPServerTransport | undefined => {
        const sessionStore = runner["mcpServer"]!["sessionStore"];
        return sessionStore.getSession(sessionId);
    };

    describe("with externallyManagedSessions enabled", () => {
        beforeEach(async () => {
            config.externallyManagedSessions = true;

            runner = new StreamableHttpRunner({ userConfig: config });
            await runner.start();
        });

        for (const responseType of ["json", "sse"] as const) {
            describe(`and httpResponseType set to ${responseType}`, () => {
                beforeEach(() => {
                    config.httpResponseType = responseType;
                });

                it("should create a new session with external session ID on initialize", async () => {
                    const sessionId = "test-external-session-123";
                    const client = await connectClient({ sessionId });
                    const response = await client.listTools();

                    expect(response).toBeDefined();
                    expect(response.tools).toBeDefined();
                    expect(response.tools.length).toBeGreaterThan(0);

                    // Verify the session is stored with the external ID
                    const storedSession = getSessionFromStore(sessionId);
                    expect(storedSession).toBeDefined();
                });

                it("should reuse existing session with the same external session ID", async () => {
                    const sessionId = "test-external-session-456";

                    // First client creates the session
                    const client1 = await connectClient({ sessionId, shouldInitialize: false });
                    const response1 = await client1.listTools();
                    expect(response1.tools).toBeDefined();

                    const session1 = getSessionFromStore(sessionId);
                    expect(session1).toBeDefined();

                    // Second client reuses the session
                    const client2 = await connectClient({ sessionId, shouldInitialize: false });
                    const response2 = await client2.listTools();
                    expect(response2.tools).toBeDefined();

                    const session2 = getSessionFromStore(sessionId);
                    expect(session2).toBe(session1);
                });

                it("should reuse existing session with the same external session ID, even after closing", async () => {
                    const sessionId = "test-external-session-456";

                    // First client creates the session
                    const client1 = await connectClient({ sessionId, shouldInitialize: false });
                    const response1 = await client1.listTools();
                    expect(response1.tools).toBeDefined();

                    const session1 = getSessionFromStore(sessionId);
                    expect(session1).toBeDefined();

                    await client1.close();

                    // Second client reuses the session
                    const client2 = await connectClient({ sessionId, shouldInitialize: false });
                    const response2 = await client2.listTools();
                    expect(response2.tools).toBeDefined();

                    // Verify it's the same session - the session should persist even after the first client closes
                    const session2 = getSessionFromStore(sessionId);
                    expect(session2).toBe(session1);
                });

                it("should allow multiple external sessions to coexist", async () => {
                    const sessionId1 = "session-1";
                    const sessionId2 = "session-2";
                    const sessionId3 = "session-3";

                    // Connect multiple clients with different session IDs and confirm
                    // they each have their own session
                    const client1 = await connectClient({ sessionId: sessionId1 });
                    const client2 = await connectClient({ sessionId: sessionId2 });
                    const client3 = await connectClient({ sessionId: sessionId3 });

                    const response1 = await client1.listTools();
                    const response2 = await client2.listTools();
                    const response3 = await client3.listTools();

                    expect(response1.tools).toBeDefined();
                    expect(response2.tools).toBeDefined();
                    expect(response3.tools).toBeDefined();

                    const session1 = getSessionFromStore(sessionId1);
                    const session2 = getSessionFromStore(sessionId2);
                    const session3 = getSessionFromStore(sessionId3);

                    expect(session1).toBeDefined();
                    expect(session2).toBeDefined();
                    expect(session3).toBeDefined();

                    expect(session1).not.toBe(session2);
                    expect(session1).not.toBe(session3);
                    expect(session2).not.toBe(session3);
                });

                it("should create session for non-initialize request with unknown session ID", async () => {
                    const sessionId = "new-session-on-non-init";

                    const client = await connectClient({ sessionId: sessionId, shouldInitialize: false });

                    await client.listTools();

                    const session = getSessionFromStore(sessionId);
                    expect(session).toBeDefined();
                });

                it("should create session for non-initialize request with unknown session ID through fetch", async () => {
                    // This is the same as the previous test but using fetch directly instead of the Client/Transport
                    const externalSessionId = "new-session-using-fetch";

                    const response = await sendHttpRequest("tools/list", externalSessionId);
                    expect(response.ok).toBe(true);

                    if (responseType === "json") {
                        const data = (await response.json()) as { result: { tools: unknown[] } | undefined };
                        expect(data.result?.tools).toBeDefined();
                    } else {
                        const data = await response.text();
                        expect(data).toContain("event: message");
                        expect(data).toContain('data: {"result":{"tools":');
                    }

                    const session = getSessionFromStore(externalSessionId);
                    expect(session).toBeDefined();
                });

                it("should reject requests without session ID", async () => {
                    const response = await sendHttpRequest("tools/list");

                    expect(response.status).toBe(400);
                    const data = (await response.json()) as { error?: { code: number; message: string } };
                    expect(data.error?.code).toBe(-32004);
                    expect(data.error?.message).toBe("invalid request");
                });

                describe("session idle timeout", () => {
                    beforeEach(async () => {
                        config.idleTimeoutMs = 1000;
                        config.notificationTimeoutMs = 500;

                        await runner?.close();
                        runner = new StreamableHttpRunner({ userConfig: config });
                        await runner.start();
                    });

                    it("should timeout idle sessions after inactivity period", async () => {
                        const sessionId = "session-to-timeout";
                        const client = await connectClient({ sessionId });
                        await client.listTools();

                        const sessionBefore = getSessionFromStore(sessionId);
                        expect(sessionBefore).toBeDefined();
                        await timeout(1100);

                        const sessionAfter = getSessionFromStore(sessionId);
                        expect(sessionAfter).toBeUndefined();
                    });
                });

                it(`should return ${responseType} responses`, async () => {
                    const externalSessionId = "json-response-session";

                    const response = await sendHttpRequest("initialize", externalSessionId);

                    expect(response.ok).toBe(true);

                    const expectedContentType = responseType === "json" ? "application/json" : "text/event-stream";
                    expect(response.headers.get("content-type")).toContain(expectedContentType);

                    const body = await response.text();
                    switch (responseType) {
                        case "json":
                            {
                                expect(response.headers.get("content-type")).toContain("application/json");
                                const data = JSON.parse(body) as { result?: unknown };
                                expect(data.result).toBeDefined();
                            }
                            break;
                        case "sse":
                            {
                                expect(response.headers.get("content-type")).toContain("text/event-stream");
                                expect(body).toContain("event: message");
                                expect(body).toContain("data: ");
                            }
                            break;
                    }
                });
            });
        }
    });

    describe("with externallyManagedSessions disabled", () => {
        beforeEach(async () => {
            config.externallyManagedSessions = false;

            runner = new StreamableHttpRunner({ userConfig: config });
            await runner.start();
        });

        it("should return SSE responses instead of JSON", async () => {
            const response = await sendHttpRequest("initialize");

            expect(response.ok).toBe(true);
            expect(response.headers.get("content-type")).toContain("text/event-stream");
            expect(response.headers.get("content-type")).not.toContain("application/json");

            const data = await response.text();
            expect(data).toContain("event: message");
            expect(data).toContain("data: ");
        });

        for (const responseType of ["json", "sse"] as const) {
            describe(`and httpResponseType set to ${responseType}`, () => {
                beforeEach(() => {
                    config.httpResponseType = responseType;
                });

                it(`should return ${responseType} responses`, async () => {
                    const response = await sendHttpRequest("initialize");

                    expect(response.ok).toBe(true);
                    switch (responseType) {
                        case "json":
                            {
                                expect(response.headers.get("content-type")).toContain("application/json");
                                const data = (await response.json()) as { result?: unknown };
                                expect(data.result).toBeDefined();
                            }
                            break;
                        case "sse":
                            {
                                expect(response.headers.get("content-type")).toContain("text/event-stream");
                                const data = await response.text();
                                expect(data).toContain("event: message");
                                expect(data).toContain("data: ");
                            }
                            break;
                    }
                });

                it("should return error when session not found", async () => {
                    const unknownSessionId = "unknown-session-id";

                    const response = await sendHttpRequest("tools/list", unknownSessionId);
                    expect(response.status).toBe(404);
                    const data = (await response.json()) as { error?: { code: number; message: string } };
                    expect(data.error?.code).toBe(-32003);
                    expect(data.error?.message).toBe("session not found");

                    const sessionStore = runner["mcpServer"]!["sessionStore"];
                    const session = sessionStore.getSession(unknownSessionId);
                    expect(session).toBeUndefined();
                });

                it("should error when client provides session ID at initialization", async () => {
                    const providedSessionId = "some-session-id";

                    const response = await sendHttpRequest("initialize", providedSessionId);
                    expect(response.ok).toBe(false);
                    expect(response.status).toBe(400);
                    const data = (await response.json()) as { error?: { code: number; message: string } };
                    expect(data.error?.code).toBe(-32005);
                    expect(data.error?.message).toBe(
                        "cannot provide sessionId when externally managed sessions are disabled"
                    );
                });
            });
        }
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

        it("handles correctly when healthCheckPort is set to 0", async () => {
            config.httpPort = 3000;
            config.healthCheckPort = 0;
            runner = new StreamableHttpRunner({ userConfig: config });
            await runner.start();

            expect(runner["healthCheckServer"]).toBeDefined();
            const healthResponse = await fetch(`${runner["healthCheckServer"]!.serverAddress}/health`);
            expect(healthResponse.status).toBe(200);
            const healthData = (await healthResponse.json()) as unknown;
            expect(healthData).toEqual({ status: "ok" });
        });
    });

    it("should pass the request headers as part of tool execution context", async () => {
        let confirmRequestInfoReceived: ((requestInfo: ToolExecutionContext["requestInfo"]) => void) | undefined;
        const requestInfoReceived = new Promise<ToolExecutionContext["requestInfo"]>((resolve) => {
            confirmRequestInfoReceived = resolve;
        });
        runner = new StreamableHttpRunner({
            userConfig: config,
            tools: [
                class RandomTool extends ToolBase {
                    static toolName = "random-tool";
                    public description = "Random tool";
                    public argsShape = {};
                    static category: ToolCategory = "mongodb";
                    static operationType: OperationType = "metadata";
                    protected execute(
                        _: ToolArgs<typeof this.argsShape>,
                        { requestInfo }: ToolExecutionContext
                    ): Promise<CallToolResult> {
                        confirmRequestInfoReceived?.(requestInfo);
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
                },
            ],
        });
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
        const requestInfo = await requestInfoReceived;
        expect(requestInfo).toBeDefined();
        const authorizationToken = requestInfo?.headers?.["authorization"] ?? requestInfo?.headers?.["Authorization"];
        expect(authorizationToken).toBe("Bearer 1234");
    });
});
