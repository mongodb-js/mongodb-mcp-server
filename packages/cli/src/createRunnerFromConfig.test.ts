import { beforeEach, describe, expect, it, vi } from "vitest";
import { NoopLogger, type CompositeLogger } from "@mongodb-js/mcp-core";
import { StdioRunner } from "@mongodb-js/mcp-core";
import type * as McpCore from "@mongodb-js/mcp-core";
import type * as McpToolsMongodb from "@mongodb-js/mcp-tools-mongodb";
import { StreamableHttpRunner } from "@mongodb-js/mcp-http-runners";
import type { TransportRequestContext } from "@mongodb-js/mcp-types";
import { UserConfigSchema } from "./config/userConfig.js";

vi.mock("./createExportsManagerFromConfig.js", () => ({
    createExportsManagerFromConfig: vi.fn().mockReturnValue({}),
}));

vi.mock("./createApiClientFromConfig.js", () => ({
    createApiClientFromConfig: vi.fn().mockReturnValue({}),
}));

vi.mock("./createTelemetryFromConfig.js", () => ({
    createTelemetryFromConfig: vi.fn().mockReturnValue({}),
}));

vi.mock("./createMonitoringServerFromConfig.js", () => ({
    createMonitoringServerFromConfig: vi.fn().mockReturnValue(undefined),
}));

vi.mock("@mongodb-js/mcp-tools-mongodb", async (importOriginal) => {
    const actual: typeof McpToolsMongodb = await importOriginal();
    return {
        ...actual,
        DeviceId: {
            create: vi.fn().mockReturnValue({}),
        },
        MCPConnectionManager: vi.fn().mockImplementation(function MockMCPConnectionManager() {
            return {};
        }),
    };
});

vi.mock("@mongodb-js/mcp-tools-atlas-local", () => ({
    createAtlasLocalClient: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@mongodb-js/mcp-core", async (importOriginal) => {
    const actual: typeof McpCore = await importOriginal();
    return {
        ...actual,
        McpServer: class MockMcpServer {
            server = {};
        },
        Elicitation: class MockElicitation {},
    };
});

const { createdSessions, createdServers } = vi.hoisted(() => ({
    createdSessions: [] as Array<{ sessionId: string; config: unknown; connectionRegistry: unknown }>,
    createdServers: [] as Array<{ id: number; session: unknown }>,
}));

vi.mock("./cliSession.js", () => ({
    Session: class MockSession {
        public sessionId = `mock-session-${createdSessions.length}`;
        public config: unknown;
        public connectionRegistry: unknown;
        public logger = {};
        constructor({ config, connectionRegistry }: { config: unknown; connectionRegistry: unknown }) {
            this.config = config;
            this.connectionRegistry = connectionRegistry;
            createdSessions.push(this);
        }
        close(): Promise<void> {
            return Promise.resolve();
        }
    },
}));

vi.mock("./cliServer.js", () => ({
    CliServer: class MockCliServer {
        public session: unknown;
        public mcpServer = { server: {} };
        constructor({ session }: { session: unknown }) {
            this.session = session;
            createdServers.push({ id: createdServers.length, session });
        }
        connect(): Promise<void> {
            return Promise.resolve();
        }
        close(): Promise<void> {
            return Promise.resolve();
        }
    },
}));

import {
    createRunnerFromConfig,
    createHttpTransportRunnerFromConfig,
    createSharedServicesFromConfig,
    createServerFromConfig,
    CliMcpHttpServer,
    type SharedServerServices,
} from "./createRunnerFromConfig.js";
import { createExportsManagerFromConfig } from "./createExportsManagerFromConfig.js";
import { createApiClientFromConfig } from "./createApiClientFromConfig.js";
import { createTelemetryFromConfig } from "./createTelemetryFromConfig.js";
import { createMonitoringServerFromConfig } from "./createMonitoringServerFromConfig.js";
import { CliServer } from "./cliServer.js";

describe("createSharedServicesFromConfig", () => {
    const serverMetadata = {
        mcpServerName: "MongoDB MCP Server",
        version: "1.2.3-test",
    };
    const logger = new NoopLogger() as unknown as CompositeLogger;

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("creates app-level infrastructure shared by all servers", async () => {
        const config = UserConfigSchema.parse({
            telemetry: "disabled",
            loggers: ["stderr"],
        });

        const services = await createSharedServicesFromConfig({
            config,
            serverMetadata,
            tools: [],
            resources: [],
            logger,
        });

        expect(createMonitoringServerFromConfig).toHaveBeenCalledWith(expect.objectContaining({ config }));
        expect(services.config).toBe(config);
        expect(services.metrics).toBeDefined();
        expect(services.keychain).toBeDefined();
        expect(services.deviceId).toBeDefined();
        expect(services.connectionStore).toBeDefined();
        expect(services.atlasLocalClient).toBeUndefined();
    });
});

describe("createServerFromConfig (per-server isolation)", () => {
    const serverMetadata = {
        mcpServerName: "MongoDB MCP Server",
        version: "1.2.3-test",
    };
    const logger = new NoopLogger() as unknown as CompositeLogger;

    beforeEach(() => {
        vi.clearAllMocks();
        createdSessions.length = 0;
        createdServers.length = 0;
    });

    async function makeShared(
        config: Parameters<typeof createSharedServicesFromConfig>[0]["config"]
    ): Promise<SharedServerServices> {
        return createSharedServicesFromConfig({
            config,
            serverMetadata,
            tools: [],
            resources: [],
            logger,
        });
    }

    it("wires config-based factories when creating a server", async () => {
        const config = UserConfigSchema.parse({
            telemetry: "disabled",
            loggers: ["stderr"],
        });

        const shared = await makeShared(config);
        const server = createServerFromConfig({ config, sharedServices: shared });

        expect(server).toBeInstanceOf(CliServer);
        expect(createExportsManagerFromConfig).toHaveBeenCalledWith(expect.objectContaining({ config }));
        expect(createApiClientFromConfig).toHaveBeenCalledWith(expect.objectContaining({ config, serverMetadata }));
        expect(createTelemetryFromConfig).toHaveBeenCalledWith(expect.objectContaining({ config, serverMetadata }));
        expect(createMonitoringServerFromConfig).toHaveBeenCalledWith(expect.objectContaining({ config }));
    });

    it("creates a fresh server per call with distinct sessions and connection registries", async () => {
        const config = UserConfigSchema.parse({
            telemetry: "disabled",
        });

        const shared = await makeShared(config);

        const serverA = createServerFromConfig({ config, sharedServices: shared });
        const serverB = createServerFromConfig({ config, sharedServices: shared });

        expect(serverA).not.toBe(serverB);
        expect(serverA.session).not.toBe(serverB.session);

        // Distinct session ids
        const sessionA = createdSessions[0]!;
        const sessionB = createdSessions[1]!;
        expect(sessionA.sessionId).not.toBe(sessionB.sessionId);

        // Each session gets its own scoped view of the shared connection store
        expect(sessionA.connectionRegistry).toBeDefined();
        expect(sessionB.connectionRegistry).toBeDefined();
        expect(sessionA.connectionRegistry).not.toBe(sessionB.connectionRegistry);

        // Session-scoped factories fire per server ...
        expect(createExportsManagerFromConfig).toHaveBeenCalledTimes(2);
        expect(createApiClientFromConfig).toHaveBeenCalledTimes(2);
        expect(createTelemetryFromConfig).toHaveBeenCalledTimes(2);
        // ... while the shared infrastructure was built exactly once for all
        // servers (one monitoring server for the whole process).
        expect(createMonitoringServerFromConfig).toHaveBeenCalledTimes(1);
        expect(createdServers[0]!.session).toBe(createdSessions[0]);
    });

    it("isolates per-request config overrides across sessions", async () => {
        const config = UserConfigSchema.parse({
            telemetry: "disabled",
            allowRequestOverrides: true,
            readOnly: false,
        });

        const shared = await makeShared(config);
        const { applyConfigOverrides } = await import("./config/configOverrides.js");

        const requestA: TransportRequestContext = {
            headers: { "x-mongodb-mcp-read-only": "true" },
            query: {},
        };
        const requestB: TransportRequestContext = {
            headers: {},
            query: {},
        };

        const configA = applyConfigOverrides({ baseConfig: config, request: requestA });
        const configB = applyConfigOverrides({ baseConfig: config, request: requestB });

        const serverA = createServerFromConfig({ config: configA, sharedServices: shared });
        const serverB = createServerFromConfig({ config: configB, sharedServices: shared });

        // Per-request config isolation: override applies to one session only
        expect((serverA.session as { config: { readOnly: boolean } }).config.readOnly).toBe(true);
        expect((serverB.session as { config: { readOnly: boolean } }).config.readOnly).toBe(false);

        expect(createdServers).toHaveLength(2);
        expect(createdSessions).toHaveLength(2);
    });
});

describe("createRunnerFromConfig", () => {
    const serverMetadata = {
        mcpServerName: "MongoDB MCP Server",
        version: "1.2.3-test",
    };
    const logger = new NoopLogger() as unknown as CompositeLogger;

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("should return a StdioRunner for the stdio transport", async () => {
        const config = UserConfigSchema.parse({
            transport: "stdio",
            telemetry: "disabled",
        });

        const runner = await createRunnerFromConfig({
            config,
            serverMetadata,
            tools: [],
            resources: [],
            logger,
        });

        expect(runner).toBeInstanceOf(StdioRunner);
    });

    it("should return a StreamableHttpRunner for the http transport", async () => {
        const config = UserConfigSchema.parse({
            transport: "http",
            telemetry: "disabled",
        });

        const runner = await createRunnerFromConfig({
            config,
            serverMetadata,
            tools: [],
            resources: [],
            logger,
        });

        expect(runner).toBeInstanceOf(StreamableHttpRunner);
    });
});

describe("CliMcpHttpServer (per-request HTTP server isolation)", () => {
    const serverMetadata = {
        mcpServerName: "MongoDB MCP Server",
        version: "1.2.3-test",
    };
    const logger = new NoopLogger() as unknown as CompositeLogger;

    beforeEach(() => {
        vi.clearAllMocks();
        createdSessions.length = 0;
        createdServers.length = 0;
    });

    async function makeShared(
        config: Parameters<typeof createSharedServicesFromConfig>[0]["config"]
    ): Promise<SharedServerServices> {
        return createSharedServicesFromConfig({
            config,
            serverMetadata,
            tools: [],
            resources: [],
            logger,
        });
    }

    it("builds a CliMcpHttpServer-backed runner without creating any server eagerly", async () => {
        const config = UserConfigSchema.parse({
            transport: "http",
            telemetry: "disabled",
        });

        const shared = await makeShared(config);
        const runner = createHttpTransportRunnerFromConfig(shared);

        expect(runner).toBeInstanceOf(StreamableHttpRunner);
        expect(createdServers).toHaveLength(0);
        expect(createdSessions).toHaveLength(0);
    });

    it("the CliMcpHttpServer creates a distinct server per session request", async () => {
        const config = UserConfigSchema.parse({
            transport: "http",
            telemetry: "disabled",
            allowRequestOverrides: true,
            readOnly: false,
        });

        const shared = await makeShared(config);
        const mcpHttpServer = new CliMcpHttpServer({
            sharedServices: shared,
            sessionStore: new (await import("@mongodb-js/mcp-core")).SessionStore({
                options: {
                    idleTimeoutMS: config.idleTimeoutMs,
                    notificationTimeoutMS: config.notificationTimeoutMs,
                    maxSessions: config.maxSessions,
                },
                logger,
                metrics: shared.metrics,
            }),
            options: {
                http: {
                    host: config.httpHost,
                    port: config.httpPort,
                    responseType: config.httpResponseType,
                    headers: config.httpHeaders,
                },
                session: {
                    externallyManagedSessions: config.externallyManagedSessions,
                    idleTimeoutMs: config.idleTimeoutMs,
                    notificationTimeoutMs: config.notificationTimeoutMs,
                },
            },
        });

        // Exercise the per-request creation hook directly with two request contexts.
        const hook = (
            mcpHttpServer as unknown as {
                createServerForRequest: (request: TransportRequestContext) => Promise<unknown>;
            }
        ).createServerForRequest.bind(mcpHttpServer);

        const serverA = await hook({
            headers: { "x-mongodb-mcp-read-only": "true" },
            query: {},
        });
        const serverB = await hook({ headers: {}, query: {} });

        expect(serverA).not.toBe(serverB);
        expect(createdSessions).toHaveLength(2);
        expect(createdSessions[0]!.connectionRegistry).not.toBe(createdSessions[1]!.connectionRegistry);

        // Request override isolation: only the first session got read-only=true
        expect((serverA as { session: { config: { readOnly: boolean } } }).session.config.readOnly).toBe(true);
        expect((serverB as { session: { config: { readOnly: boolean } } }).session.config.readOnly).toBe(false);
    });
});
