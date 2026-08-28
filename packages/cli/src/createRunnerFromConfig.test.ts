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

const { createdServers } = vi.hoisted(() => ({
    createdServers: [] as Array<{ id: number; session: unknown }>,
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
        expect(serverA.session.connectionRegistry).toBe(appServices.connectionRegistry);
        expect(serverB.session.connectionRegistry).toBe(appServices.connectionRegistry);

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
        expect((serverA.session as { config: { readOnly: boolean } }).config.readOnly).toBe(true);
        expect((serverB.session as { config: { readOnly: boolean } }).config.readOnly).toBe(false);

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

        // Both request-scoped servers share the same app-level connection registry.
        expect(
            (serverA as { session: { connectionRegistry: unknown } }).session.connectionRegistry
        ).toBe(appServices.connectionRegistry);
        expect(
            (serverB as { session: { connectionRegistry: unknown } }).session.connectionRegistry
        ).toBe(appServices.connectionRegistry);

        // Request override isolation: only the first request got read-only=true
        expect((serverA as { session: { config: { readOnly: boolean } } }).session.config.readOnly).toBe(true);
        expect((serverB as { session: { config: { readOnly: boolean } } }).session.config.readOnly).toBe(false);
    });
});
