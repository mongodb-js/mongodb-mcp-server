import { beforeEach, describe, expect, it, vi } from "vitest";
import { NoopLogger, type CompositeLogger } from "@mongodb-js/mcp-core";
import { StdioRunner } from "@mongodb-js/mcp-core";
import type * as McpCore from "@mongodb-js/mcp-core";
import type { ConnectionRegistry } from "@mongodb-js/mcp-tools-mongodb";
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

const { createdServers } = vi.hoisted(() => ({
    createdServers: [] as Array<{ id: number; config: unknown; connectionRegistry: unknown }>,
}));

vi.mock("./cliServer.js", () => ({
    CliServer: class MockCliServer {
        public config: unknown;
        public connectionRegistry: unknown;
        public mcpServer = { server: {} };
        constructor(options: { config: unknown; connectionRegistry: unknown }) {
            this.config = options.config;
            this.connectionRegistry = options.connectionRegistry;
            createdServers.push({ id: createdServers.length, ...options });
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
    createAppServicesFromConfig,
    createServerFromConfig,
    CliMcpHttpServer,
    type AppServices,
} from "./createRunnerFromConfig.js";
import { createExportsManagerFromConfig } from "./createExportsManagerFromConfig.js";
import { createApiClientFromConfig } from "./createApiClientFromConfig.js";
import { createTelemetryFromConfig } from "./createTelemetryFromConfig.js";
import { createMonitoringServerFromConfig } from "./createMonitoringServerFromConfig.js";
import { CliServer } from "./cliServer.js";

describe("createAppServicesFromConfig", () => {
    const serverMetadata = {
        mcpServerName: "MongoDB MCP Server",
        version: "1.2.3-test",
    };
    const logger = new NoopLogger() as unknown as CompositeLogger;

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("creates app-level infrastructure once, shared by every request", async () => {
        const config = UserConfigSchema.parse({
            telemetry: "disabled",
            loggers: ["stderr"],
        });

        const appServices = await createAppServicesFromConfig({
            config,
            serverMetadata,
            tools: [],
            resources: [],
            logger,
        });

        expect(createMonitoringServerFromConfig).toHaveBeenCalledWith(expect.objectContaining({ config }));
        expect(createExportsManagerFromConfig).toHaveBeenCalledWith(expect.objectContaining({ config }));
        expect(createApiClientFromConfig).toHaveBeenCalledWith(expect.objectContaining({ config, serverMetadata }));
        expect(createTelemetryFromConfig).toHaveBeenCalledWith(expect.objectContaining({ config, serverMetadata }));
        expect(appServices.config).toBe(config);
        expect(appServices.metrics).toBeDefined();
        expect(appServices.keychain).toBeDefined();
        expect(appServices.deviceId).toBeDefined();
        expect(appServices.connectionStore).toBeDefined();
        expect(appServices.connectionRegistry).toBeDefined();
        expect(appServices.atlasLocalClient).toBeUndefined();
    });
});

describe("createServerFromConfig (request-scoped server)", () => {
    const serverMetadata = {
        mcpServerName: "MongoDB MCP Server",
        version: "1.2.3-test",
    };
    const logger = new NoopLogger() as unknown as CompositeLogger;

    beforeEach(() => {
        vi.clearAllMocks();
        createdServers.length = 0;
    });

    async function makeAppServices(
        config: Parameters<typeof createAppServicesFromConfig>[0]["config"]
    ): Promise<AppServices> {
        return createAppServicesFromConfig({
            config,
            serverMetadata,
            tools: [],
            resources: [],
            logger,
        });
    }

    it("wires config-based factories once at the app level", async () => {
        const config = UserConfigSchema.parse({
            telemetry: "disabled",
            loggers: ["stderr"],
        });

        const appServices = await makeAppServices(config);
        const server = createServerFromConfig({ config, appServices });

        expect(server).toBeInstanceOf(CliServer);
        expect(createExportsManagerFromConfig).toHaveBeenCalledTimes(1);
        expect(createApiClientFromConfig).toHaveBeenCalledTimes(1);
        expect(createTelemetryFromConfig).toHaveBeenCalledTimes(1);
        expect(createMonitoringServerFromConfig).toHaveBeenCalledTimes(1);
    });

    it("creates a fresh server per call over the same shared app-level services", async () => {
        const config = UserConfigSchema.parse({
            telemetry: "disabled",
        });

        const appServices = await makeAppServices(config);

        const serverA = createServerFromConfig({ config, appServices });
        const serverB = createServerFromConfig({ config, appServices });

        expect(serverA).not.toBe(serverB);

        // Both request-scoped servers share the SAME app-level connection
        // registry: connections survive across requests.
        expect(serverA.connectionRegistry).toBe(appServices.connectionRegistry);
        expect(serverB.connectionRegistry).toBe(appServices.connectionRegistry);

        // App-level factories ran exactly once for the whole process.
        expect(createExportsManagerFromConfig).toHaveBeenCalledTimes(1);
        expect(createApiClientFromConfig).toHaveBeenCalledTimes(1);
        expect(createTelemetryFromConfig).toHaveBeenCalledTimes(1);
        expect(createdServers).toHaveLength(2);
    });

    it("carries per-request config overrides on the request-scoped server", async () => {
        const config = UserConfigSchema.parse({
            telemetry: "disabled",
            allowRequestOverrides: true,
            readOnly: false,
        });

        const appServices = await makeAppServices(config);
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

        const serverA = createServerFromConfig({ config: configA, appServices });
        const serverB = createServerFromConfig({ config: configB, appServices });

        // Per-request config isolation: override applies to one request only.
        expect((serverA.config as { readOnly: boolean }).readOnly).toBe(true);
        expect((serverB.config as { readOnly: boolean }).readOnly).toBe(false);

        expect(createdServers).toHaveLength(2);
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

describe("CliMcpHttpServer (per-request HTTP server)", () => {
    const serverMetadata = {
        mcpServerName: "MongoDB MCP Server",
        version: "1.2.3-test",
    };
    const logger = new NoopLogger() as unknown as CompositeLogger;

    beforeEach(() => {
        vi.clearAllMocks();
        createdServers.length = 0;
    });

    async function makeAppServices(
        config: Parameters<typeof createAppServicesFromConfig>[0]["config"]
    ): Promise<AppServices> {
        return createAppServicesFromConfig({
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

        const appServices = await makeAppServices(config);
        const runner = createHttpTransportRunnerFromConfig(appServices);

        expect(runner).toBeInstanceOf(StreamableHttpRunner);
        expect(createdServers).toHaveLength(0);
    });

    it("the CliMcpHttpServer creates a distinct server per request over shared services", async () => {
        const config = UserConfigSchema.parse({
            transport: "http",
            telemetry: "disabled",
            allowRequestOverrides: true,
            readOnly: false,
        });

        const appServices = await makeAppServices(config);
        const mcpHttpServer = new CliMcpHttpServer({
            appServices,
            options: {
                http: {
                    host: config.httpHost,
                    port: config.httpPort,
                    responseType: config.httpResponseType,
                    headers: config.httpHeaders,
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
        expect(createdServers).toHaveLength(2);

        // HTTP requests (even anonymous ones) get isolated registry views over
        // the shared store — never the app-level registry itself.
        expect((serverA as { connectionRegistry: unknown }).connectionRegistry).not.toBe(
            appServices.connectionRegistry
        );
        expect((serverB as { connectionRegistry: unknown }).connectionRegistry).not.toBe(
            appServices.connectionRegistry
        );

        // Request override isolation: only the first request got read-only=true
        expect((serverA as { config: { readOnly: boolean } }).config.readOnly).toBe(true);
        expect((serverB as { config: { readOnly: boolean } }).config.readOnly).toBe(false);
    });

    it("scopes connections per client identity: same name shares, different names isolate", async () => {
        const config = UserConfigSchema.parse({
            transport: "http",
            telemetry: "disabled",
        });

        const appServices = await makeAppServices(config);
        const mcpHttpServer = new CliMcpHttpServer({
            appServices,
            options: {
                http: {
                    host: config.httpHost,
                    port: config.httpPort,
                    responseType: config.httpResponseType,
                    headers: config.httpHeaders,
                },
            },
        });

        const hook = (
            mcpHttpServer as unknown as {
                createServerForRequest: (request: TransportRequestContext) => Promise<unknown>;
            }
        ).createServerForRequest.bind(mcpHttpServer);

        const clientA1 = await hook({ headers: { "x-mcp-client-name": "alice" }, query: {} });
        const clientA2 = await hook({ headers: { "x-mcp-client-name": "alice" }, query: {} });
        const clientB = await hook({ headers: { "x-mcp-client-name": "bob" }, query: {} });
        const unnamed = await hook({ headers: {}, query: {} });

        const regA = (clientA1 as { connectionRegistry: ConnectionRegistry }).connectionRegistry;
        const regA2 = (clientA2 as { connectionRegistry: ConnectionRegistry }).connectionRegistry;
        const regB = (clientB as { connectionRegistry: ConnectionRegistry }).connectionRegistry;
        const regGlobal = (unnamed as { connectionRegistry: ConnectionRegistry }).connectionRegistry;

        // Different clients / unnamed clients hold distinct registry views.
        expect(regA).not.toBe(regB);
        expect(regA).not.toBe(regGlobal);
        expect(regB).not.toBe(regGlobal);

        // An anonymous request is isolated too: it never sees identified
        // clients' connections (and holds no cross-request state).
        expect(regGlobal).not.toBe(appServices.connectionRegistry);

        // Behavioral scoping: a connection created by "alice" is visible to
        // alice's later request (same stable scope across requests), but
        // invisible to "bob" and to unnamed clients.
        const created = await regA.createEntry({ name: "alice-conn" });
        expect(created.connectionId).toBeDefined();
        // A connection created by "alice" is visible to alice's later request
        // (same stable scope across requests), but invisible to "bob" and to
        // anonymous requests (each gets its own isolated view).
        expect(await regA2.get(created.connectionId)).toBe(created);
        expect(await regB.get(created.connectionId)).toBeUndefined();
        expect(await regGlobal.get(created.connectionId)).toBeUndefined();
    });

    it("scopes connections by verified authInfo.clientId, ignoring spoofable headers", async () => {
        const config = UserConfigSchema.parse({
            transport: "http",
            telemetry: "disabled",
        });

        const appServices = await makeAppServices(config);
        const mcpHttpServer = new CliMcpHttpServer({
            appServices,
            options: {
                http: {
                    host: config.httpHost,
                    port: config.httpPort,
                    responseType: config.httpResponseType,
                    headers: config.httpHeaders,
                },
            },
        });

        const hook = (
            mcpHttpServer as unknown as {
                createServerForRequest: (request: TransportRequestContext) => Promise<unknown>;
            }
        ).createServerForRequest.bind(mcpHttpServer);

        // Authenticated requests scope by the verified clientId. Two requests
        // from the same verified client share a scope even if they send
        // different (spoofable) client-name headers.
        const authedA1 = await hook({
            headers: { "x-mcp-client-name": "spoofed" },
            query: {},
            authInfo: { mode: "authenticated", state: { token: "t", clientId: "verified-client-1", scopes: [] } },
        });
        const authedA2 = await hook({
            headers: { "x-mcp-client-name": "other-spoof" },
            query: {},
            authInfo: { mode: "authenticated", state: { token: "t", clientId: "verified-client-1", scopes: [] } },
        });
        const authedB = await hook({
            headers: { "x-mcp-client-name": "spoofed" },
            query: {},
            authInfo: { mode: "authenticated", state: { token: "t", clientId: "verified-client-2", scopes: [] } },
        });

        const regA1 = (authedA1 as { connectionRegistry: ConnectionRegistry }).connectionRegistry;
        const regA2 = (authedA2 as { connectionRegistry: ConnectionRegistry }).connectionRegistry;
        const regB = (authedB as { connectionRegistry: ConnectionRegistry }).connectionRegistry;

        // Same verified clientId → the same connection is visible across requests,
        // regardless of the (client-controlled) name headers.
        const created = await regA1.createEntry({ name: "authed-conn" });
        expect(await regA2.get(created.connectionId)).toBe(created);

        // A different verified client cannot see it, even sending the same header.
        expect(await regB.get(created.connectionId)).toBeUndefined();
    });
});
