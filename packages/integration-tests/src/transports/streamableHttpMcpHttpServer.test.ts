import { StreamableHttpRunner, MCPHttpServer } from "@mongodb-js/mcp-http-runners";
import { SessionStore, type ISessionStore, CompositeLogger, Keychain, type ToolClass } from "@mongodb-js/mcp-core";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UserConfig } from "mongodb-mcp-server";
import {
    CliServer,
    CliSession,
    Elicitation,
    connectionErrorHandler,
    MCPConnectionManager,
    ExportsManager,
    packageInfo,
    ToolBase,
    type OperationType,
    type ToolCategory,
    AllTools,
} from "mongodb-mcp-server";
import type { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type {
    CallToolResult,
    DefaultMetricDefinitions,
    HttpServerOptions,
    IMetrics,
    SessionManagementOptions,
    TransportRequestContext,
} from "@mongodb-js/mcp-types";
import type { DeviceId } from "@mongodb-js/mcp-tools-mongodb";
import type { AtlasTelemetry, TelemetryToolMetadata } from "@mongodb-js/mcp-atlas-telemetry";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { PrometheusMetrics, createDefaultMetrics } from "@mongodb-js/mcp-metrics";
import { defaultTestConfig, createTestApiClient } from "../integrationHelpers.js";
import { createAtlasLocalClient } from "@mongodb-js/mcp-tools-atlas-local";

async function createTestServer(
    config: UserConfig,
    options: {
        tools?: ToolClass[];
    } = {}
): Promise<CliServer> {
    const logger = new CompositeLogger({ loggers: [] });
    const keychain = Keychain.root;

    const exportsManager = ExportsManager.init({
        options: {
            exportsPath: config.exportsPath,
            exportTimeoutMs: config.exportTimeoutMs,
            exportCleanupIntervalMs: config.exportCleanupIntervalMs,
        },
        logger,
    });

    const connectionManager = new MCPConnectionManager({
        logger,
        deviceId: {} as unknown as DeviceId,
        options: {
            connectionInfo: { transport: "http", httpHost: "localhost" },
            displayName: packageInfo.mcpServerName,
            version: packageInfo.version,
        },
    });

    const apiClient = createTestApiClient({
        baseUrl: config.apiBaseUrl,
        userAgent: `mongodb-mcp-server/${packageInfo.version}`,
        logger,
        clientId: "test-client-id",
        clientSecret: "test-client-secret",
    });

    vi.spyOn(apiClient, "validateAuthConfig").mockResolvedValue(undefined);
    vi.spyOn(apiClient, "close").mockResolvedValue(undefined);

    const atlasLocalClient = await createAtlasLocalClient({ logger });

    const mcpServer = new McpServer({
        name: "test-server",
        version: packageInfo.version,
    });

    const elicitation = new Elicitation({ server: mcpServer.server });

    const session = new CliSession({
        userConfig: config,
        logger,
        exportsManager,
        connectionManager,
        keychain,
        apiClient,
        connectionErrorHandler,
        atlasLocalClient,
    });

    const metrics = new PrometheusMetrics({ definitions: createDefaultMetrics() });

    return new CliServer({
        session,
        mcpServer,
        telemetry: {
            emitEvents: () => {},
            close: () => Promise.resolve(),
            isTelemetryEnabled: () => false,
        } as unknown as AtlasTelemetry,
        connectionErrorHandler,
        elicitation,
        metrics,
        tools: options.tools,
        serverMetadata: {
            mcpServerName: "test-server",
            version: "1.0",
            engines: {
                node: "20.0.0",
            },
        },
    });
}

class TestMCPHttpServer extends MCPHttpServer<CliServer> {
    protected userConfig: UserConfig;
    protected tools?: ToolClass[];

    constructor({
        userConfig,
        options,
        logger,
        metrics,
        sessionStore,
        tools,
    }: {
        userConfig: UserConfig;
        options: {
            http: HttpServerOptions;
            session: SessionManagementOptions;
        };
        logger: CompositeLogger;
        metrics: IMetrics<DefaultMetricDefinitions>;
        sessionStore: ISessionStore<StreamableHTTPServerTransport>;
        tools?: ToolClass[];
    }) {
        super({
            options,
            logger,
            metrics,
            sessionStore: sessionStore as SessionStore<StreamableHTTPServerTransport>,
        });
        this.userConfig = userConfig;
        this.tools = tools;
    }

    protected override async createServerForRequest(request: TransportRequestContext): Promise<CliServer> {
        void request;
        return createTestServer(this.userConfig, { tools: this.tools });
    }
}

type RunnerComponents = {
    runner: StreamableHttpRunner<CliServer>;
    sessionStore: ISessionStore<StreamableHTTPServerTransport>;
};

function createRunnerComponents({
    mcpHttpServer,
    sessionStore,
}: {
    mcpHttpServer: MCPHttpServer<CliServer>;
    sessionStore: ISessionStore<StreamableHTTPServerTransport>;
}): RunnerComponents {
    const logger = new CompositeLogger({ loggers: [] });
    const metrics = new PrometheusMetrics({ definitions: createDefaultMetrics() });

    const runner = new StreamableHttpRunner<CliServer>({
        logger,
        metrics,
        mcpHttpServer,
        sessionStore,
    });

    return { runner, sessionStore };
}

function getServerAddress(runner: StreamableHttpRunner<CliServer>): string {
    return (runner as unknown as { mcpHttpServer: { serverAddress: string } }).mcpHttpServer.serverAddress;
}

function getSessionStore(runner: StreamableHttpRunner<CliServer>): ISessionStore<StreamableHTTPServerTransport> {
    return (runner as unknown as { sessionStore: ISessionStore<StreamableHTTPServerTransport> }).sessionStore;
}

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

    const getSessionFromStore = async (sessionId: string): Promise<StreamableHTTPServerTransport | undefined> => {
        return getSessionStore(runner).getSession(sessionId);
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

    describe("session initialization failure handling", () => {
        let connectCallCount = 0;

        class ConnectFailingMCPHttpServer extends TestMCPHttpServer {
            protected override async createServerForRequest(request: TransportRequestContext): Promise<CliServer> {
                const server = await super.createServerForRequest(request);
                const originalConnect = server.connect.bind(server);
                vi.spyOn(server, "connect").mockImplementation(async (transport) => {
                    connectCallCount++;
                    if (connectCallCount === 1) {
                        throw new Error("Simulated connection failure");
                    }
                    return originalConnect(transport);
                });
                return server;
            }
        }

        beforeEach(async () => {
            connectCallCount = 0;
            config.externallyManagedSessions = true;
            config.httpResponseType = "json";

            const logger = new CompositeLogger({ loggers: [] });
            const metrics = new PrometheusMetrics({ definitions: createDefaultMetrics() });
            const sessionStore = new SessionStore<StreamableHTTPServerTransport>({
                options: {
                    idleTimeoutMS: config.idleTimeoutMs,
                    notificationTimeoutMS: config.notificationTimeoutMs,
                },
                logger,
                metrics,
            });

            const mcpHttpServer = new ConnectFailingMCPHttpServer({
                userConfig: config,
                options: {
                    http: {
                        host: config.httpHost,
                        port: config.httpPort,
                        bodyLimit: config.httpBodyLimit,
                        responseType: config.httpResponseType,
                    },
                    session: {
                        idleTimeoutMs: config.idleTimeoutMs,
                        notificationTimeoutMs: config.notificationTimeoutMs,
                        externallyManagedSessions: config.externallyManagedSessions,
                    },
                },
                logger,
                metrics,
                sessionStore,
                tools: AllTools,
            });

            ({ runner } = createRunnerComponents({ mcpHttpServer, sessionStore }));
            await runner.start();
        });

        it("should not store session when server.connect() fails, allowing retry to succeed", async () => {
            const sessionId = "failing-session-test";

            const firstResponse = await sendHttpRequest({ method: "tools/list", sessionId });
            expect(firstResponse.ok).toBe(false);
            expect(firstResponse.status).toBe(400);

            expect(await getSessionFromStore(sessionId)).toBeUndefined();

            const secondResponse = await sendHttpRequest({ method: "tools/list", sessionId });
            expect(secondResponse.ok).toBe(true);

            expect(await getSessionFromStore(sessionId)).toBeDefined();
            expect(connectCallCount).toBe(2);
        });

        it("should only call addSession after successful server.connect()", async () => {
            const sessionId = "addsession-order-test";
            let addSessionCallCount = 0;
            const addSessionCalls: { beforeConnect: boolean; afterConnect: boolean }[] = [];

            const sessionStore = getSessionStore(runner);
            const originalAddSession = sessionStore.addSession.bind(sessionStore);
            sessionStore.addSession = async (params): Promise<void> => {
                addSessionCallCount++;
                addSessionCalls.push({
                    beforeConnect: connectCallCount === 0,
                    afterConnect: connectCallCount > 0,
                });
                return originalAddSession(params);
            };

            const firstResponse = await sendHttpRequest({ method: "tools/list", sessionId });
            expect(firstResponse.ok).toBe(false);
            expect(addSessionCallCount).toBe(0);

            const secondResponse = await sendHttpRequest({ method: "tools/list", sessionId });
            expect(secondResponse.ok).toBe(true);
            expect(addSessionCallCount).toBe(1);
            expect(addSessionCalls).toHaveLength(1);
            expect(addSessionCalls[0]).toEqual({ beforeConnect: false, afterConnect: true });

            const thirdResponse = await sendHttpRequest({ method: "tools/list", sessionId });
            expect(thirdResponse.ok).toBe(true);
            expect(addSessionCallCount).toBe(1);
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
                                readOnly: this.session.config.readOnly,
                                maxDocumentsPerQuery: (this.session.config as UserConfig).maxDocumentsPerQuery,
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
                sessionStore,
            }: {
                baseConfig: UserConfig;
                options: {
                    http: HttpServerOptions;
                    session: SessionManagementOptions;
                };
                logger: CompositeLogger;
                metrics: IMetrics<DefaultMetricDefinitions>;
                sessionStore: ISessionStore<StreamableHTTPServerTransport>;
            }) {
                super({
                    options,
                    logger,
                    metrics,
                    sessionStore: sessionStore as SessionStore<StreamableHTTPServerTransport>,
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
                sessionStore,
            }: {
                baseConfig: UserConfig;
                options: {
                    http: HttpServerOptions;
                    session: SessionManagementOptions;
                };
                logger: CompositeLogger;
                metrics: IMetrics<DefaultMetricDefinitions>;
                sessionStore: ISessionStore<StreamableHTTPServerTransport>;
            }) {
                super({
                    options,
                    logger,
                    metrics,
                    sessionStore: sessionStore as SessionStore<StreamableHTTPServerTransport>,
                });
                this.baseConfig = baseConfig;
            }

            protected override async createServerForRequest(request: TransportRequestContext): Promise<CliServer> {
                const userRole = request.headers?.["x-user-role"];
                const tools: ToolClass[] = userRole === "admin" ? [UserTool, AdminTool] : [UserTool];
                return createTestServer(this.baseConfig, { tools });
            }
        }

        it("should customize server configuration based on request headers", async () => {
            const logger = new CompositeLogger({ loggers: [] });
            const metrics = new PrometheusMetrics({ definitions: createDefaultMetrics() });
            const sessionStore = new SessionStore<StreamableHTTPServerTransport>({
                options: {
                    idleTimeoutMS: config.idleTimeoutMs,
                    notificationTimeoutMS: config.notificationTimeoutMs,
                },
                logger,
                metrics,
            });

            const mcpHttpServer = new RoleBasedMCPHttpServer({
                baseConfig: config,
                options: {
                    http: {
                        host: config.httpHost,
                        port: config.httpPort,
                        responseType: config.httpResponseType,
                    },
                    session: {
                        idleTimeoutMs: config.idleTimeoutMs,
                        notificationTimeoutMs: config.notificationTimeoutMs,
                        externallyManagedSessions: config.externallyManagedSessions,
                    },
                },
                logger,
                metrics,
                sessionStore,
            });

            ({ runner } = createRunnerComponents({ mcpHttpServer, sessionStore }));
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
            const sessionStore = new SessionStore<StreamableHTTPServerTransport>({
                options: {
                    idleTimeoutMS: config.idleTimeoutMs,
                    notificationTimeoutMS: config.notificationTimeoutMs,
                },
                logger,
                metrics,
            });

            const mcpHttpServer = new RoleBasedToolsMCPHttpServer({
                baseConfig: config,
                options: {
                    http: {
                        host: config.httpHost,
                        port: config.httpPort,
                        responseType: config.httpResponseType,
                    },
                    session: {
                        idleTimeoutMs: config.idleTimeoutMs,
                        notificationTimeoutMs: config.notificationTimeoutMs,
                        externallyManagedSessions: config.externallyManagedSessions,
                    },
                },
                logger,
                metrics,
                sessionStore,
            });

            ({ runner } = createRunnerComponents({ mcpHttpServer, sessionStore }));
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
