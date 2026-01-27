import { StreamableHttpRunner } from "../../../src/transports/streamableHttp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { describe, expect, it, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import type { LoggerType, LogLevel, LogPayload } from "../../../src/common/logger.js";
import { LoggerBase, LogId } from "../../../src/common/logger.js";
import { createMCPConnectionManager } from "../../../src/common/connectionManager.js";
import { Keychain } from "../../../src/common/keychain.js";
import { defaultTestConfig, timeout } from "../helpers.js";
import { type UserConfig } from "../../../src/common/config/userConfig.js";
import type { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

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
            beforeAll(async () => {
                config.httpHeaders = headers;
                runner = new StreamableHttpRunner({ userConfig: config });
                await runner.start();
            });

            afterAll(async () => {
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
                const transport = new StreamableHTTPClientTransport(new URL(`${testRunner.serverAddress}/mcp`));

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

                const response = await fetch(`${testRunner.serverAddress}/mcp`, {
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

    const sendHttpRequest = async (method: "initialize" | "tools/list", sessionId?: string): Promise<Response> => {
        const headers: Record<string, string> = {
            "Content-Type": "application/json",
            accept: "application/json, text/event-stream",
        };
        if (sessionId) {
            headers["mcp-session-id"] = sessionId;
        }

        const response = await fetch(`${runner.serverAddress}/mcp`, {
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

    describe("with externallyManagedSessions enabled", () => {
        let clients: Client[] = [];

        const connectClient = async ({
            sessionId,
            shouldInitialize = true,
        }: {
            sessionId: string;
            shouldInitialize?: boolean;
        }): Promise<Client> => {
            const client = new Client({
                name: "test",
                version: "0.0.0",
            });
            const transport = new StreamableHTTPClientTransport(new URL(`${runner.serverAddress}/mcp`), {
                requestInit: shouldInitialize
                    ? {
                          headers: {
                              "mcp-session-id": sessionId,
                          },
                      }
                    : undefined,
                sessionId: shouldInitialize ? undefined : sessionId,
            });

            await client.connect(transport);
            clients.push(client);
            return client;
        };

        const getSessionFromStore = (sessionId: string): StreamableHTTPServerTransport | undefined => {
            const sessionStore = runner["sessionStore"];
            return sessionStore.getSession(sessionId);
        };

        beforeEach(async () => {
            config.externallyManagedSessions = true;

            runner = new StreamableHttpRunner({ userConfig: config });
            await runner.start();
        });

        afterEach(async () => {
            for (const client of clients) {
                await client.close();
            }
            clients = [];

            if (runner) {
                await runner.close();
            }
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
            const data = (await response.json()) as { result: { tools: unknown[] } | undefined };
            expect(data.result?.tools).toBeDefined();

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

        it("should return JSON responses instead of SSE", async () => {
            const externalSessionId = "json-response-session";

            const response = await sendHttpRequest("initialize", externalSessionId);

            expect(response.ok).toBe(true);
            expect(response.headers.get("content-type")).toContain("application/json");
            expect(response.headers.get("content-type")).not.toContain("text/event-stream");

            const data = (await response.json()) as { result?: unknown };
            expect(data.result).toBeDefined();
        });
    });

    describe("with externallyManagedSessions disabled", () => {
        beforeEach(async () => {
            config.externallyManagedSessions = false;

            runner = new StreamableHttpRunner({ userConfig: config });
            await runner.start();
        });

        afterEach(async () => {
            if (runner) {
                await runner.close();
            }
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

        it("should return error when session not found", async () => {
            const unknownSessionId = "unknown-session-id";

            const response = await sendHttpRequest("tools/list", unknownSessionId);
            expect(response.status).toBe(404);
            const data = (await response.json()) as { error?: { code: number; message: string } };
            expect(data.error?.code).toBe(-32003);
            expect(data.error?.message).toBe("session not found");

            const sessionStore = runner["sessionStore"];
            const session = sessionStore.getSession(unknownSessionId);
            expect(session).toBeUndefined();
        });
    });
});
