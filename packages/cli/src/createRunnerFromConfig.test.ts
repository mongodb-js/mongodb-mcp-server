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
            create: vi.fn().mockReturnValue({
                // Must not collide with the global crypto: createServerServices
                // uses globalThis.crypto.randomUUID() for ephemeral scopes.
                get: vi.fn((fn: () => string) => Promise.resolve(fn())),
            }),
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
        public connectionRegistry: { close(): Promise<void> };
        public mcpServer = { server: {} };
        constructor(options: { config: unknown; connectionRegistry: { close(): Promise<void> } }) {
            this.config = options.config;
            this.connectionRegistry = options.connectionRegistry;
            createdServers.push({ id: createdServers.length, ...options });
        }
        connect(): Promise<void> {
            return Promise.resolve();
        }
        // Mirrors the real CliServer.close(): the registry view is closed with
        // the server (owned views reap their connections, unowned ones no-op).
        close(): Promise<void> {
            return this.connectionRegistry.close();
        }
    },
}));

import {
    createRunnerFromConfig,
    createHttpTransportRunnerFromConfig,
    createSharedServicesFromConfig,
    createServerFromConfig,
    CliMcpHttpServer,
    connectionScopeByClientNameHeader,
    connectionScopeFromConfig,
    CLIENT_SCOPE_HEADER,
    SESSION_ID_HEADER,
    type SharedServerServices,
} from "./createRunnerFromConfig.js";
import { createExportsManagerFromConfig } from "./createExportsManagerFromConfig.js";
import { createApiClientFromConfig } from "./createApiClientFromConfig.js";
import { createTelemetryFromConfig } from "./createTelemetryFromConfig.js";
import { createMonitoringServerFromConfig } from "./createMonitoringServerFromConfig.js";
import { CliServer } from "./cliServer.js";

// Example connection-scope policies. The library ships only the seam
// (connectionScope is required, and `undefined` → ephemeral); the per-user and
// per-client policies are the embedder's decision, so these are local fixtures
// that exercise the seam's fail-closed behavior rather than public API.

/** Per verified user via the OIDC `sub` claim (fail-closed: no `sub` → ephemeral). */
function userPrincipalScope(request: TransportRequestContext): string | undefined {
    if (!request.authInfo) {
        return undefined;
    }
    const { clientId, extra } = request.authInfo;
    const sub = extra?.sub;
    if (typeof sub !== "string" || !sub.trim()) {
        return undefined;
    }
    return `user:${clientId}\u001f${sub}`;
}

/** Per OAuth client application (application-level isolation; M2M only). */
function clientIdScope(request: TransportRequestContext): string | undefined {
    if (!request.authInfo) {
        return undefined;
    }
    return `client:${request.authInfo.clientId}`;
}

describe("createSharedServicesFromConfig", () => {
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

        const sharedServices = await createSharedServicesFromConfig({
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
        expect(sharedServices.config).toBe(config);
        expect(sharedServices.metrics).toBeDefined();
        expect(sharedServices.keychain).toBeDefined();
        expect(sharedServices.deviceId).toBeDefined();
        expect(sharedServices.connectionStore).toBeDefined();
        expect(sharedServices.connectionRegistry).toBeDefined();
        expect(sharedServices.atlasLocalClient).toBeUndefined();
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

    async function makeSharedServerServices(
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

    it("wires config-based factories once at the app level", async () => {
        const config = UserConfigSchema.parse({
            telemetry: "disabled",
            loggers: ["stderr"],
        });

        const sharedServices = await makeSharedServerServices(config);
        const server = createServerFromConfig({ config, sharedServices });

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

        const sharedServices = await makeSharedServerServices(config);

        const serverA = createServerFromConfig({ config, sharedServices });
        const serverB = createServerFromConfig({ config, sharedServices });

        expect(serverA).not.toBe(serverB);

        // Both request-scoped servers share the SAME app-level connection
        // registry: connections survive across requests.
        expect(serverA.connectionRegistry).toBe(sharedServices.connectionRegistry);
        expect(serverB.connectionRegistry).toBe(sharedServices.connectionRegistry);

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

        const sharedServices = await makeSharedServerServices(config);
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

        const serverA = createServerFromConfig({ config: configA, sharedServices });
        const serverB = createServerFromConfig({ config: configB, sharedServices });

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

    async function makeSharedServerServices(
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

        const sharedServices = await makeSharedServerServices(config);
        const runner = createHttpTransportRunnerFromConfig(sharedServices);

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

        const sharedServices = await makeSharedServerServices(config);
        const mcpHttpServer = new CliMcpHttpServer({
            sharedServices,
            options: {
                http: {
                    host: config.httpHost,
                    port: config.httpPort,
                    responseType: config.httpResponseType,
                    headers: config.httpHeaders,
                },
                connectionScope: connectionScopeByClientNameHeader,
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
            sharedServices.connectionRegistry
        );
        expect((serverB as { connectionRegistry: unknown }).connectionRegistry).not.toBe(
            sharedServices.connectionRegistry
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

        const sharedServices = await makeSharedServerServices(config);
        const mcpHttpServer = new CliMcpHttpServer({
            sharedServices,
            options: {
                http: {
                    host: config.httpHost,
                    port: config.httpPort,
                    responseType: config.httpResponseType,
                    headers: config.httpHeaders,
                },
                connectionScope: connectionScopeByClientNameHeader,
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
        expect(regGlobal).not.toBe(sharedServices.connectionRegistry);

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

    it("a per-user connection-scope policy isolates users within one shared OAuth client", async () => {
        // Regression test: clientId identifies the OAuth client application,
        // not the end user. Two users authenticated through the same shared
        // client registration must not see each other's connections.
        const config = UserConfigSchema.parse({
            transport: "http",
            telemetry: "disabled",
        });

        const sharedServices = await makeSharedServerServices(config);
        const mcpHttpServer = new CliMcpHttpServer({
            sharedServices,
            options: {
                http: {
                    host: config.httpHost,
                    port: config.httpPort,
                    responseType: config.httpResponseType,
                    headers: config.httpHeaders,
                },
                connectionScope: userPrincipalScope,
            },
        });

        const hook = (
            mcpHttpServer as unknown as {
                createServerForRequest: (request: TransportRequestContext) => Promise<unknown>;
            }
        ).createServerForRequest.bind(mcpHttpServer);

        const sharedClient = "shared-org-gateway";
        const alice1 = await hook({
            headers: {},
            query: {},
            authInfo: { token: "t", clientId: sharedClient, scopes: [], extra: { sub: "alice" } },
        });
        const alice2 = await hook({
            headers: {},
            query: {},
            authInfo: { token: "t", clientId: sharedClient, scopes: [], extra: { sub: "alice" } },
        });
        // Bob authenticates through the SAME OAuth client as alice.
        const bob = await hook({
            headers: {},
            query: {},
            authInfo: { token: "t", clientId: sharedClient, scopes: [], extra: { sub: "bob" } },
        });
        // The same subject under a DIFFERENT client is also a different scope.
        const otherClientAlice = await hook({
            headers: {},
            query: {},
            authInfo: { token: "t", clientId: "other-client", scopes: [], extra: { sub: "alice" } },
        });

        const regAlice1 = (alice1 as { connectionRegistry: ConnectionRegistry }).connectionRegistry;
        const regAlice2 = (alice2 as { connectionRegistry: ConnectionRegistry }).connectionRegistry;
        const regBob = (bob as { connectionRegistry: ConnectionRegistry }).connectionRegistry;
        const regOtherAlice = (otherClientAlice as { connectionRegistry: ConnectionRegistry }).connectionRegistry;

        // Same user, same client → the connection survives across her requests.
        const created = await regAlice1.createEntry({ name: "alice-conn" });
        expect(await regAlice2.get(created.connectionId)).toBe(created);

        // A different user behind the same OAuth client cannot see it...
        expect(await regBob.get(created.connectionId)).toBeUndefined();
        // ...and neither can the same subject under a different client.
        expect(await regOtherAlice.get(created.connectionId)).toBeUndefined();
    });

    it("a per-user scope policy fails closed: requests without a usable sub claim get ephemeral, isolated scopes", async () => {
        const config = UserConfigSchema.parse({
            transport: "http",
            telemetry: "disabled",
        });

        const sharedServices = await makeSharedServerServices(config);
        const mcpHttpServer = new CliMcpHttpServer({
            sharedServices,
            options: {
                http: {
                    host: config.httpHost,
                    port: config.httpPort,
                    responseType: config.httpResponseType,
                    headers: config.httpHeaders,
                },
                connectionScope: userPrincipalScope,
            },
        });

        const hook = (
            mcpHttpServer as unknown as {
                createServerForRequest: (request: TransportRequestContext) => Promise<unknown>;
            }
        ).createServerForRequest.bind(mcpHttpServer);

        const scopedUser = await hook({
            headers: {},
            query: {},
            authInfo: { token: "t", clientId: "client-1", scopes: [], extra: { sub: "alice" } },
        });
        // Non-string claims do not qualify as a principal...
        const numericSub = await hook({
            headers: {},
            query: {},
            authInfo: { token: "t", clientId: "client-1", scopes: [], extra: { sub: 42 } },
        });
        // ...and neither does a missing claim.
        const noPrincipal1 = await hook({
            headers: {},
            query: {},
            authInfo: { token: "t", clientId: "client-1", scopes: [] },
        });
        const noPrincipal2 = await hook({
            headers: {},
            query: {},
            authInfo: { token: "t", clientId: "client-1", scopes: [] },
        });

        const regUser = (scopedUser as { connectionRegistry: ConnectionRegistry }).connectionRegistry;
        const regNumericSub = (numericSub as { connectionRegistry: ConnectionRegistry }).connectionRegistry;
        const regNoPrincipal1 = (noPrincipal1 as { connectionRegistry: ConnectionRegistry }).connectionRegistry;
        const regNoPrincipal2 = (noPrincipal2 as { connectionRegistry: ConnectionRegistry }).connectionRegistry;

        // No silent sharing: a request without a usable `sub` gets an
        // ephemeral scope — it cannot see the scoped user's entries...
        const byUser = await regUser.createEntry({ name: "user-conn" });
        expect(await regNoPrincipal1.get(byUser.connectionId)).toBeUndefined();
        expect(await regNumericSub.get(byUser.connectionId)).toBeUndefined();

        // ...and two principal-less requests do NOT fall back into one shared
        // clientId namespace (the pre-fix behavior); each is ephemeral and
        // isolated even from the other.
        const ephemeral1 = await regNoPrincipal1.createEntry({ name: "ephemeral-conn" });
        expect(await regNoPrincipal2.get(ephemeral1.connectionId)).toBeUndefined();
        expect(await regNumericSub.get(ephemeral1.connectionId)).toBeUndefined();
    });

    it("a per-client connection-scope policy keys on the verified clientId, ignoring spoofable headers", async () => {
        // Application-level scope: only safe when tokens represent the client
        // application itself (M2M / client credentials) or when per-user
        // isolation is explicitly not wanted.
        const config = UserConfigSchema.parse({
            transport: "http",
            telemetry: "disabled",
        });

        const sharedServices = await makeSharedServerServices(config);
        const mcpHttpServer = new CliMcpHttpServer({
            sharedServices,
            options: {
                http: {
                    host: config.httpHost,
                    port: config.httpPort,
                    responseType: config.httpResponseType,
                    headers: config.httpHeaders,
                },
                connectionScope: clientIdScope,
            },
        });

        const hook = (
            mcpHttpServer as unknown as {
                createServerForRequest: (request: TransportRequestContext) => Promise<unknown>;
            }
        ).createServerForRequest.bind(mcpHttpServer);

        // Two requests from the same verified client share a scope even if
        // they send different (spoofable) client-name headers.
        const authedA1 = await hook({
            headers: { "x-mcp-client-name": "spoofed" },
            query: {},
            authInfo: { token: "t", clientId: "verified-client-1", scopes: [] },
        });
        const authedA2 = await hook({
            headers: { "x-mcp-client-name": "other-spoof" },
            query: {},
            authInfo: { token: "t", clientId: "verified-client-1", scopes: [] },
        });
        const authedB = await hook({
            headers: { "x-mcp-client-name": "spoofed" },
            query: {},
            authInfo: { token: "t", clientId: "verified-client-2", scopes: [] },
        });
        // Unauthenticated requests get ephemeral scopes under this policy —
        // the header is ignored, only verified identity keys the scope.
        const unauthed1 = await hook({ headers: { "x-mcp-client-name": "spoofed" }, query: {} });
        const unauthed2 = await hook({ headers: { "x-mcp-client-name": "spoofed" }, query: {} });

        const regA1 = (authedA1 as { connectionRegistry: ConnectionRegistry }).connectionRegistry;
        const regA2 = (authedA2 as { connectionRegistry: ConnectionRegistry }).connectionRegistry;
        const regB = (authedB as { connectionRegistry: ConnectionRegistry }).connectionRegistry;
        const regUnauthed1 = (unauthed1 as { connectionRegistry: ConnectionRegistry }).connectionRegistry;
        const regUnauthed2 = (unauthed2 as { connectionRegistry: ConnectionRegistry }).connectionRegistry;

        // Same verified clientId → the same connection is visible across requests,
        // regardless of the (client-controlled) name headers.
        const created = await regA1.createEntry({ name: "authed-conn" });
        expect(await regA2.get(created.connectionId)).toBe(created);

        // A different verified client cannot see it, even sending the same header.
        expect(await regB.get(created.connectionId)).toBeUndefined();

        // Unauthenticated requests are ephemeral and isolated — even from each other.
        expect(await regUnauthed1.get(created.connectionId)).toBeUndefined();
        const anonymous = await regUnauthed1.createEntry({ name: "anon-conn" });
        expect(await regUnauthed2.get(anonymous.connectionId)).toBeUndefined();
    });

    it("a per-client scope is the embedder's choice — the seam does not protect a misapplied app-level policy", async () => {
        // Documents the hazard: the library ships only the seam (connectionScope
        // is required; `undefined` → ephemeral). If a consumer deliberately
        // ships a clientId-scope for a multi-user deployment, two users of one
        // shared client WILL share connections — there is no guard. That's why
        // per-user isolation is the embedder's responsibility to get right.
        const config = UserConfigSchema.parse({
            transport: "http",
            telemetry: "disabled",
        });

        const sharedServices = await makeSharedServerServices(config);
        const mcpHttpServer = new CliMcpHttpServer({
            sharedServices,
            options: {
                http: {
                    host: config.httpHost,
                    port: config.httpPort,
                    responseType: config.httpResponseType,
                    headers: config.httpHeaders,
                },
                connectionScope: clientIdScope,
            },
        });

        const hook = (
            mcpHttpServer as unknown as {
                createServerForRequest: (request: TransportRequestContext) => Promise<unknown>;
            }
        ).createServerForRequest.bind(mcpHttpServer);

        const alice = await hook({
            headers: {},
            query: {},
            authInfo: { token: "t", clientId: "shared-org-gateway", scopes: [], extra: { sub: "alice" } },
        });
        const bob = await hook({
            headers: {},
            query: {},
            authInfo: { token: "t", clientId: "shared-org-gateway", scopes: [], extra: { sub: "bob" } },
        });

        const regAlice = (alice as { connectionRegistry: ConnectionRegistry }).connectionRegistry;
        const regBob = (bob as { connectionRegistry: ConnectionRegistry }).connectionRegistry;
        const created = await regAlice.createEntry({ name: "alice-conn" });
        // Under a clientId scope, bob can see alice's connection — the leak.
        expect(await regBob.get(created.connectionId)).toBe(created);
    });

    it("fails closed when an HTTP request is served without a connectionScope policy", async () => {
        const config = UserConfigSchema.parse({
            transport: "http",
            telemetry: "disabled",
        });

        const sharedServices = await makeSharedServerServices(config);
        // Direct callers (not via CliMcpHttpServer) supplying a `request` must
        // supply a policy — no implicit default is applied.
        expect(() =>
            createServerFromConfig({
                config,
                sharedServices,
                request: { headers: {}, query: {} },
            })
        ).toThrow(/no connectionScope policy was set/);
    });

    it("ephemeral (anonymous) connections are reaped when the request-scoped server closes", async () => {
        // v2.x `connectionScope: "session"` behavior: a session's connections
        // die with it — the legacy sessionful path closes the server when the
        // session ends.
        const config = UserConfigSchema.parse({
            transport: "http",
            telemetry: "disabled",
        });

        const sharedServices = await makeSharedServerServices(config);
        const server = createServerFromConfig({
            config,
            sharedServices,
            request: { headers: {}, query: {} },
            connectionScope: connectionScopeByClientNameHeader,
        });

        const created = await server.connectionRegistry.createEntry({ name: "session-conn" });
        // The app-level view sees the entry while the session is alive.
        expect(await sharedServices.connectionRegistry.get(created.connectionId)).toBe(created);

        await server.close();

        // After the session ends, the ephemeral scope's entries are revoked —
        // unreachable even from the unbound app-level view.
        expect(await sharedServices.connectionRegistry.get(created.connectionId)).toBeUndefined();
        expect(await server.connectionRegistry.get(created.connectionId)).toBeUndefined();
    });

    it("stable-scope connections survive the request-scoped server closing", async () => {
        // Header-keyed (and auth-keyed) scopes are shared across requests, so
        // closing one request's server must not reap them.
        const config = UserConfigSchema.parse({
            transport: "http",
            telemetry: "disabled",
        });

        const sharedServices = await makeSharedServerServices(config);
        const request: TransportRequestContext = { headers: { [CLIENT_SCOPE_HEADER]: "alice" }, query: {} };
        const server = createServerFromConfig({
            config,
            sharedServices,
            request,
            connectionScope: connectionScopeByClientNameHeader,
        });

        const created = await server.connectionRegistry.createEntry({ name: "alice-conn" });
        await server.close();

        const nextRequest = createServerFromConfig({
            config,
            sharedServices,
            request,
            connectionScope: connectionScopeByClientNameHeader,
        });
        expect(await nextRequest.connectionRegistry.get(created.connectionId)).toBe(created);
    });

    describe("connectionScope config (v2.x semantics)", () => {
        it("defaults to 'session'", () => {
            expect(UserConfigSchema.parse({}).connectionScope).toBe("session");
        });

        it("'global' shares one scope across all clients and survives session close", async () => {
            const config = UserConfigSchema.parse({
                transport: "http",
                telemetry: "disabled",
                connectionScope: "global",
            });

            const sharedServices = await makeSharedServerServices(config);
            const policy = connectionScopeFromConfig(config);

            const anon = createServerFromConfig({
                config,
                sharedServices,
                request: { headers: {}, query: {} },
                connectionScope: policy,
            });
            const named = createServerFromConfig({
                config,
                sharedServices,
                request: { headers: { [CLIENT_SCOPE_HEADER]: "alice" }, query: {} },
                connectionScope: policy,
            });

            // Every request — named or anonymous — lands in the one global scope.
            const created = await anon.connectionRegistry.createEntry({ name: "shared-conn" });
            expect(await named.connectionRegistry.get(created.connectionId)).toBe(created);

            // Session rotation does not reap global connections.
            await anon.close();
            expect(await named.connectionRegistry.get(created.connectionId)).toBe(created);
        });

        it("'session' keys on mcp-session-id; without one it is ephemeral", () => {
            const config = UserConfigSchema.parse({
                transport: "http",
                telemetry: "disabled",
                connectionScope: "session",
            });

            // v2.x "session": requests carrying an mcp-session-id resolve to that
            // id as their scope; a request without one (or with an oversized one)
            // is ephemeral. The x-mcp-client-name header is NOT used here.
            const policy = connectionScopeFromConfig(config);
            expect(policy({ headers: { [SESSION_ID_HEADER]: "sess-1" }, query: {} })).toBe("sess-1");
            expect(policy({ headers: { [CLIENT_SCOPE_HEADER]: "alice" }, query: {} })).toBeUndefined();
            expect(policy({ headers: {}, query: {} })).toBeUndefined();
            // Oversized / non-string ids fail closed.
            expect(policy({ headers: { [SESSION_ID_HEADER]: "x".repeat(600) }, query: {} })).toBeUndefined();
            expect(policy({ headers: { [SESSION_ID_HEADER]: ["a", "b"] }, query: {} })).toBeUndefined();
        });

        it("stateless requests sharing an mcp-session-id see each other's connections", async () => {
            const config = UserConfigSchema.parse({
                transport: "http",
                telemetry: "disabled",
                connectionScope: "session",
            });
            const sharedServices = await makeSharedServerServices(config);
            const policy = connectionScopeFromConfig(config);

            const req = (id?: string): TransportRequestContext => ({
                headers: id ? { [SESSION_ID_HEADER]: id } : {},
                query: {},
            });

            const a1 = createServerFromConfig({
                config,
                sharedServices,
                request: req("sess-1"),
                connectionScope: policy,
            });
            const a2 = createServerFromConfig({
                config,
                sharedServices,
                request: req("sess-1"),
                connectionScope: policy,
            });
            const b = createServerFromConfig({
                config,
                sharedServices,
                request: req("sess-2"),
                connectionScope: policy,
            });
            const anon = createServerFromConfig({ config, sharedServices, request: req(), connectionScope: policy });

            // Same session id → visible across requests (sessionless persistence).
            const created = await a1.connectionRegistry.createEntry({ name: "sess-conn" });
            expect(await a2.connectionRegistry.get(created.connectionId)).toBe(created);

            // Different (or absent) session id → isolated.
            expect(await b.connectionRegistry.get(created.connectionId)).toBeUndefined();
            expect(await anon.connectionRegistry.get(created.connectionId)).toBeUndefined();
        });
    });
});
