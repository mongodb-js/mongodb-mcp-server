import { MCPHttpServer, StreamableHttpRunner } from "@mongodb-js/mcp-http-runners";
import { CompositeLogger, type AnyToolClass } from "@mongodb-js/mcp-core";
import type {
    CallToolResult,
    DefaultMetricDefinitions,
    HttpServerOptions,
    IMetrics,
    TransportRequestContext,
} from "@mongodb-js/mcp-types";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { PrometheusMetrics, createDefaultMetrics } from "@mongodb-js/mcp-metrics";
import type { TelemetryToolMetadata } from "@mongodb-js/mcp-atlas-telemetry";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ToolBase, type CliServer, type OperationType, type ToolCategory, type UserConfig } from "mongodb-mcp-server";
import { defaultTestConfig } from "../integrationHelpers.js";
import { createTestServer } from "../helpers/createTestServer.js";
import { createStreamableHttpTestRunner, getServerAddress } from "../helpers/streamableHttpTestRunner.js";

describe("MCPHttpServer (streamable HTTP)", () => {
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

    const sendHttpRequest = async ({
        method,
        sessionId,
        additionalHeaders = {},
    }: {
        method: "initialize" | "tools/list";
        sessionId?: string;
        additionalHeaders?: Record<string, string>;
    }): Promise<Response> => {
        const headers: Record<string, string> = {
            "Content-Type": "application/json",
            accept: "application/json, text/event-stream",
            ...additionalHeaders,
        };
        if (sessionId) {
            headers["mcp-session-id"] = sessionId;
        }

        return fetch(`${getServerAddress(runner)}/mcp`, {
            method: "POST",
            headers,
            body: JSON.stringify({
                jsonrpc: "2.0",
                method,
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
    };

    beforeEach(() => {
        config = {
            ...defaultTestConfig,
            httpPort: 0,
        };
        clients = [];
    });

    afterEach(async () => {
        for (const client of clients) {
            await client.close();
        }
        clients = [];
        await runner?.close();
        runner = undefined as unknown as StreamableHttpRunner<CliServer>;
    });

    describe("server startup from config", () => {
        it("starts an HTTP server bound to the configured host/port", async () => {
            ({ runner } = createStreamableHttpTestRunner(config));
            await runner.start();

            const address = getServerAddress(runner);
            expect(address).toMatch(new RegExp(`^http://${config.httpHost}:\\d+$`));

            // The server is live: a malformed body is answered by the SDK's
            // error handling rather than a connection failure.
            const response = await fetch(`${address}/mcp`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: "not json",
            });
            expect(response.status).toBeGreaterThanOrEqual(400);
        });
    });

    describe("stateless 2025-era requests", () => {
        beforeEach(async () => {
            ({ runner } = createStreamableHttpTestRunner(config));
            await runner.start();
        });

        it("serves initialize with no session id via the stateless fallback", async () => {
            const response = await sendHttpRequest({ method: "initialize" });
            expect(response.ok).toBe(true);
        });

        it("serves tools/list with no session id via the stateless fallback", async () => {
            const response = await sendHttpRequest({ method: "tools/list" });
            expect(response.ok).toBe(true);
        });

        it("serves a full client session over HTTP", async () => {
            const client = await connectClient({});
            const response = await client.listTools();
            expect(response).toBeDefined();
            expect(response.tools.length).toBeGreaterThan(0);
        });

        it("ignores arbitrary mcp-session-id headers", async () => {
            const response = await sendHttpRequest({ method: "tools/list", sessionId: "arbitrary-session-id" });
            expect(response.ok).toBe(true);

            const response2 = await sendHttpRequest({ method: "initialize", sessionId: "arbitrary-session-id" });
            expect(response2.ok).toBe(true);
        });
    });

    describe("HTTP header validation", () => {
        it("rejects requests with a missing configured header and accepts the correct one", async () => {
            config.httpHeaders = { "x-custom-header": "test-value" };
            ({ runner } = createStreamableHttpTestRunner(config));
            await runner.start();

            const rejected = await sendHttpRequest({ method: "initialize" });
            expect(rejected.status).toBe(403);
            const body = (await rejected.json()) as { error?: string };
            expect(body.error).toContain("Invalid value for header");

            const accepted = await sendHttpRequest({
                method: "initialize",
                additionalHeaders: { "x-custom-header": "test-value" },
            });
            expect(accepted.ok).toBe(true);
        });
    });

    describe("modern protocol path (2026-07-28)", () => {
        it("serves modern-era clients", async () => {
            ({ runner } = createStreamableHttpTestRunner(config));
            await runner.start();

            const transport = new StreamableHTTPClientTransport(new URL(`${getServerAddress(runner)}/mcp`), {});
            const client = new Client(
                { name: "modern-test", version: "1.0.0" },
                { versionNegotiation: { mode: "auto" }, capabilities: { elicitation: {} } }
            );
            clients.push(client);
            await client.connect(transport);

            expect(client.getProtocolEra()).toBe("modern");

            const { tools } = await client.listTools();
            expect(tools.length).toBeGreaterThan(0);

            await transport.close();
        });
    });

    describe("with createServerForRequest override", () => {
        class ConfigCheckTool extends ToolBase {
            static toolName = "config-check";
            public description = "Check current configuration";
            public argsShape = {};
            static category: ToolCategory = "mongodb";
            static operationType: OperationType = "metadata";

            protected execute(): Promise<CallToolResult> {
                return Promise.resolve({
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify({
                                readOnly: this.server.config.readOnly,
                                maxDocumentsPerQuery: (this.server.config as UserConfig).maxDocumentsPerQuery,
                            }),
                        },
                    ],
                });
            }

            protected resolveTelemetryMetadata(): TelemetryToolMetadata {
                return {};
            }
        }

        class RoleBasedMCPHttpServer extends MCPHttpServer<CliServer> {
            private readonly baseConfig: UserConfig;

            constructor({
                baseConfig,
                options,
                logger,
                metrics,
            }: {
                baseConfig: UserConfig;
                options: {
                    http: HttpServerOptions;
                };
                logger: CompositeLogger;
                metrics: IMetrics<DefaultMetricDefinitions>;
            }) {
                super({
                    options,
                    logger,
                    metrics,
                });
                this.baseConfig = baseConfig;
            }

            protected override async createServerForRequest(request: TransportRequestContext): Promise<CliServer> {
                const userRole = request.headers?.["x-user-role"];
                let sessionConfig: UserConfig = { ...this.baseConfig };

                if (userRole === "analyst") {
                    sessionConfig = {
                        ...sessionConfig,
                        readOnly: true,
                        maxDocumentsPerQuery: 10,
                    };
                } else if (userRole === "admin") {
                    sessionConfig = {
                        ...sessionConfig,
                        readOnly: false,
                        maxDocumentsPerQuery: 1000,
                    };
                }

                return createTestServer(sessionConfig, { tools: [ConfigCheckTool] });
            }
        }

        class UserTool extends ToolBase {
            static toolName = "user-tool";
            public description = "Available to users";
            public argsShape = {};
            static category: ToolCategory = "mongodb";
            static operationType: OperationType = "metadata";

            protected execute(): Promise<CallToolResult> {
                return Promise.resolve({
                    content: [{ type: "text", text: "user tool executed" }],
                });
            }

            protected resolveTelemetryMetadata(): TelemetryToolMetadata {
                return {};
            }
        }

        class AdminTool extends ToolBase {
            static toolName = "admin-tool";
            public description = "Available to admins only";
            public argsShape = {};
            static category: ToolCategory = "mongodb";
            static operationType: OperationType = "create";

            protected execute(): Promise<CallToolResult> {
                return Promise.resolve({
                    content: [{ type: "text", text: "admin tool executed" }],
                });
            }

            protected resolveTelemetryMetadata(): TelemetryToolMetadata {
                return {};
            }
        }

        class RoleBasedToolsMCPHttpServer extends MCPHttpServer<CliServer> {
            private readonly baseConfig: UserConfig;

            constructor({
                baseConfig,
                options,
                logger,
                metrics,
            }: {
                baseConfig: UserConfig;
                options: {
                    http: HttpServerOptions;
                };
                logger: CompositeLogger;
                metrics: IMetrics<DefaultMetricDefinitions>;
            }) {
                super({
                    options,
                    logger,
                    metrics,
                });
                this.baseConfig = baseConfig;
            }

            protected override async createServerForRequest(request: TransportRequestContext): Promise<CliServer> {
                const userRole = request.headers?.["x-user-role"];
                const tools: AnyToolClass[] = userRole === "admin" ? [UserTool, AdminTool] : [UserTool];
                return createTestServer(this.baseConfig, { tools });
            }
        }

        it("should customize server configuration based on request headers", async () => {
            const logger = new CompositeLogger({ loggers: [] });
            const metrics = new PrometheusMetrics({ definitions: createDefaultMetrics() });

            const mcpHttpServer = new RoleBasedMCPHttpServer({
                baseConfig: config,
                options: {
                    http: {
                        host: config.httpHost,
                        port: config.httpPort,
                        bodyLimit: config.httpBodyLimit,
                        responseType: config.httpResponseType,
                        authMode: "unauthenticated",
                    },
                },
                logger,
                metrics,
            });

            runner = new StreamableHttpRunner<CliServer>({
                logger,
                mcpHttpServer,
            });
            await runner.start();

            const analystClient = await connectClient({ additionalHeaders: { "x-user-role": "analyst" } });
            const analystResponse = (await analystClient.callTool({
                name: "config-check",
                arguments: {},
            })) as { content: { text: string }[] };
            const analystConfig = JSON.parse(analystResponse.content[0]?.text ?? "{}") as {
                readOnly: boolean;
                maxDocumentsPerQuery: number;
            };
            expect(analystConfig.readOnly).toBe(true);
            expect(analystConfig.maxDocumentsPerQuery).toBe(10);

            const adminClient = await connectClient({ additionalHeaders: { "x-user-role": "admin" } });
            const adminResponse = (await adminClient.callTool({
                name: "config-check",
                arguments: {},
            })) as { content: { text: string }[] };
            const adminConfig = JSON.parse(adminResponse.content[0]?.text ?? "{}") as {
                readOnly: boolean;
                maxDocumentsPerQuery: number;
            };
            expect(adminConfig.readOnly).toBe(false);
            expect(adminConfig.maxDocumentsPerQuery).toBe(1000);

            const defaultClient = await connectClient({ additionalHeaders: {} });
            const defaultResponse = (await defaultClient.callTool({
                name: "config-check",
                arguments: {},
            })) as { content: { text: string }[] };
            const defaultConfigResult = JSON.parse(defaultResponse.content[0]?.text ?? "{}") as {
                readOnly: boolean;
                maxDocumentsPerQuery: number;
            };
            expect(defaultConfigResult.readOnly).toBe(config.readOnly);
            expect(defaultConfigResult.maxDocumentsPerQuery).toBe(config.maxDocumentsPerQuery);
        });

        it("should allow customizing tools based on request context", async () => {
            const logger = new CompositeLogger({ loggers: [] });
            const metrics = new PrometheusMetrics({ definitions: createDefaultMetrics() });

            const mcpHttpServer = new RoleBasedToolsMCPHttpServer({
                baseConfig: config,
                options: {
                    http: {
                        host: config.httpHost,
                        port: config.httpPort,
                        responseType: config.httpResponseType,
                        authMode: "unauthenticated",
                    },
                },
                logger,
                metrics,
            });

            runner = new StreamableHttpRunner<CliServer>({
                logger,
                mcpHttpServer,
            });
            await runner.start();

            const userClient = await connectClient({ additionalHeaders: { "x-user-role": "user" } });
            const userTools = await userClient.listTools();
            expect(userTools.tools).toHaveLength(1);
            expect(userTools.tools[0]?.name).toBe("user-tool");

            const adminClient = await connectClient({ additionalHeaders: { "x-user-role": "admin" } });
            const adminTools = await adminClient.listTools();
            expect(adminTools.tools).toHaveLength(2);
            const toolNames = adminTools.tools.map((t) => t.name).sort();
            expect(toolNames).toEqual(["admin-tool", "user-tool"]);
        });
    });
});
