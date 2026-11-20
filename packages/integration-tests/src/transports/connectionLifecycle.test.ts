import { EventEmitter } from "events";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import {
    CliMcpHttpServer,
    UserConfigSchema,
    closeSharedServices,
    createKeychainFromConfig,
    createServerFromConfig,
    createSharedServicesFromConfig,
    type CliServer,
    type SharedServerServices,
    type UserConfig,
} from "@mongodb-js/mcp-cli";
import { CompositeLogger, InMemoryTransport } from "@mongodb-js/mcp-core";
import {
    ConnectTool,
    ConnectionSummarySchema,
    CountTool,
    DisconnectTool,
    ListConnectionsTool,
    PRECONFIGURED_CONNECTION_ID,
} from "@mongodb-js/mcp-tools-mongodb";
import { NodeDriverServiceProvider } from "@mongosh/service-provider-node-driver";
import { MongoClient, MongoServerError } from "mongodb";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { z } from "zod";

const CONNECTION_STRING = "mongodb://localhost:27017";
const OIDC_CONNECTION_STRING = `${CONNECTION_STRING}/?authMechanism=MONGODB-OIDC`;
const REQUEST_TIMEOUT_MS = 5_000;
const EXPECTED_COUNT = 7;
const ConnectResultSchema = z.object({ connectionId: z.string() });
const ConnectionsResultSchema = z.object({ connections: z.array(ConnectionSummarySchema) });

type Deferred<T> = {
    promise: Promise<T>;
    resolve: (value: T) => void;
    reject: (reason: Error) => void;
};

type AuthBus = NonNullable<Parameters<typeof NodeDriverServiceProvider.connect>[3]>;

function deferred<T>(): Deferred<T> {
    let resolve!: Deferred<T>["resolve"];
    let reject!: Deferred<T>["reject"];
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

function completeAuthentication(bus: AuthBus): void {
    bus.emit("mongodb-oidc-plugin:auth-succeeded", {
        authStateId: "test-auth",
        tokenType: null,
        refreshToken: null,
        expiresAt: null,
        passIdTokenAsAccessToken: false,
        tokens: { accessToken: undefined, idToken: undefined, refreshToken: undefined },
        forceRefreshOrReauth: false,
        willRetryWithForceRefreshOrReauth: false,
        tokenSetId: "test-token-set",
    });
}

async function connect(client: Client, connectionString = CONNECTION_STRING): Promise<string> {
    const result = await client.callTool(
        { name: "connect", arguments: { connectionString } },
        { timeout: REQUEST_TIMEOUT_MS }
    );
    expect(result.isError).not.toBe(true);
    return ConnectResultSchema.parse(result.structuredContent).connectionId;
}

async function listConnections(client: Client): Promise<z.infer<typeof ConnectionSummarySchema>[]> {
    const result = await client.callTool({ name: "list-connections", arguments: {} }, { timeout: REQUEST_TIMEOUT_MS });
    expect(result.isError).not.toBe(true);
    return ConnectionsResultSchema.parse(result.structuredContent).connections;
}

function count(client: Client, connectionId: string, signal?: AbortSignal): ReturnType<Client["callTool"]> {
    return client.callTool(
        {
            name: "count",
            arguments: { connectionId, database: "test", collection: "lifecycle" },
        },
        { signal, timeout: REQUEST_TIMEOUT_MS }
    );
}

describe.each(["in-memory", "http"] as const)(
    "MongoDB connection lifecycle over %s",
    { timeout: 10_000 },
    (transport) => {
        let sharedServices: SharedServerServices | undefined;
        let httpServer: CliMcpHttpServer | undefined;
        let servers: CliServer[];
        let clients: Set<Client>;
        let pipes: Promise<void>[];
        let pendingConnections: Deferred<NodeDriverServiceProvider>[];
        let provider: NodeDriverServiceProvider;
        let connectDriver: MockInstance<typeof NodeDriverServiceProvider.connect>;
        let closeProvider: MockInstance<NodeDriverServiceProvider["close"]>;
        let countDocuments: MockInstance<NodeDriverServiceProvider["countDocuments"]>;

        async function createClient(): Promise<Client> {
            if (!sharedServices) {
                throw new Error("The test application has not been started");
            }
            const client = new Client({ name: "connection-lifecycle-client", version: "1.0.0" });
            clients.add(client);

            if (httpServer) {
                await client.connect(new StreamableHTTPClientTransport(new URL(`${httpServer.serverAddress}/mcp`)), {
                    timeout: REQUEST_TIMEOUT_MS,
                });
            } else {
                const server = createServerFromConfig({ config: sharedServices.config, sharedServices });
                servers.push(server);
                const clientTransport = new InMemoryTransport();
                const serverTransport = new InMemoryTransport();
                pipes.push(
                    clientTransport.output.pipeTo(serverTransport.input),
                    serverTransport.output.pipeTo(clientTransport.input)
                );
                await server.connect(serverTransport);
                await client.connect(clientTransport, { timeout: REQUEST_TIMEOUT_MS });
            }
            return client;
        }

        async function startApplication(overrides: Partial<UserConfig> = {}): Promise<Client> {
            const config = UserConfigSchema.parse({
                transport: transport === "http" ? "http" : "stdio",
                httpHost: "127.0.0.1",
                httpPort: 0,
                telemetry: "disabled",
                loggers: [],
                indexCheck: false,
                connectionIdleTimeoutMs: 0,
                ...overrides,
            });
            const logger = new CompositeLogger();
            sharedServices = await createSharedServicesFromConfig({
                config,
                serverMetadata: { mcpServerName: "connection-lifecycle-test", version: "1.0.0" },
                tools: [ConnectTool, CountTool, DisconnectTool, ListConnectionsTool],
                resources: [],
                logger,
                keychain: createKeychainFromConfig({ config }),
            });
            if (transport === "http") {
                httpServer = new CliMcpHttpServer({
                    sharedServices,
                    options: {
                        http: { host: config.httpHost, port: config.httpPort, responseType: "sse" },
                        connectionScope: (): string => "connection-lifecycle-test",
                    },
                });
                await httpServer.start();
            }
            return createClient();
        }

        function pendingDial(): {
            result: Deferred<NodeDriverServiceProvider>;
            started: Promise<AuthBus>;
        } {
            const result = deferred<NodeDriverServiceProvider>();
            const started = deferred<AuthBus>();
            pendingConnections.push(result);
            connectDriver.mockImplementationOnce((_uri, _options, _cliOptions, bus) => {
                if (!bus) {
                    throw new Error("Expected the driver's authentication event bus");
                }
                started.resolve(bus);
                return result.promise;
            });
            return { result, started: started.promise };
        }

        beforeEach(() => {
            sharedServices = undefined;
            httpServer = undefined;
            servers = [];
            clients = new Set();
            pipes = [];
            pendingConnections = [];
            provider = new NodeDriverServiceProvider(new MongoClient(CONNECTION_STRING), new EventEmitter(), {
                productName: "connection-lifecycle-test",
                productDocsLink: "https://github.com/mongodb-js/mongodb-mcp-server",
            });
            closeProvider = vi.spyOn(provider, "close").mockResolvedValue(undefined);
            countDocuments = vi
                .spyOn(provider, "countDocuments")
                .mockImplementation((_database, _collection, _query, options) => {
                    options?.signal?.throwIfAborted();
                    return Promise.resolve(EXPECTED_COUNT);
                });
            connectDriver = vi.spyOn(NodeDriverServiceProvider, "connect").mockResolvedValue(provider);
        });

        afterEach(async () => {
            for (const connection of pendingConnections) {
                connection.resolve(provider);
            }
            try {
                for (const client of clients) {
                    await client.close();
                }
                for (const server of servers) {
                    await server.close();
                }
                if (httpServer) {
                    await httpServer.stop();
                } else if (sharedServices) {
                    await closeSharedServices(sharedServices);
                }
                await Promise.all(pipes);
            } finally {
                sharedServices?.deviceId.close();
                vi.restoreAllMocks();
            }
        }, 10_000);

        it("returns a tool error for failed authentication and allows an explicit retry without leaking a handle", async () => {
            connectDriver.mockRejectedValueOnce(new MongoServerError({ message: "Authentication failed", code: 18 }));
            const client = await startApplication();
            const failed = await client.callTool(
                { name: "connect", arguments: { connectionString: CONNECTION_STRING } },
                { timeout: REQUEST_TIMEOUT_MS }
            );
            expect(failed.isError).toBe(true);
            expect(failed.structuredContent).toBeUndefined();
            expect(await listConnections(client)).toEqual([]);

            const connectionId = await connect(client);
            expect(await listConnections(client)).toEqual([
                expect.objectContaining({ connectionId, source: "explicit", state: "connected" }),
            ]);
            expect(await count(client, connectionId)).toMatchObject({
                structuredContent: { count: EXPECTED_COUNT },
            });
            expect(connectDriver).toHaveBeenCalledTimes(2);
        });

        it("cancels a pending preconfigured request without poisoning the shared connection or its retry", async () => {
            const countInvocations = vi.spyOn(CountTool.prototype, "invoke");
            const dial = pendingDial();
            const client = await startApplication({ connectionString: CONNECTION_STRING });
            const controller = new AbortController();
            const pending = count(client, PRECONFIGURED_CONNECTION_ID, controller.signal);
            await dial.started;
            const serverSignal = countInvocations.mock.calls[0]?.[1].request.signal;
            if (!serverSignal) {
                throw new Error("Expected the SDK request signal to reach the count tool");
            }
            await Promise.all([
                expect(pending).rejects.toThrow("Cancelled connection wait"),
                new Promise<void>((resolve) => {
                    serverSignal.addEventListener("abort", () => resolve(), { once: true });
                    controller.abort(new Error("Cancelled connection wait"));
                }),
            ]);
            expect(serverSignal.aborted).toBe(true);
            expect(countDocuments).not.toHaveBeenCalled();

            const retry = count(client, PRECONFIGURED_CONNECTION_ID);
            dial.result.resolve(provider);
            expect(await retry).toMatchObject({ structuredContent: { count: EXPECTED_COUNT } });
            await vi.waitFor(() => {
                const signals = countDocuments.mock.calls.map((call) => call[3]?.signal);
                expect(signals.some((signal) => signal?.aborted)).toBe(true);
                expect(signals.some((signal) => signal && !signal.aborted)).toBe(true);
            });
            expect(await listConnections(client)).toEqual([
                expect.objectContaining({ connectionId: PRECONFIGURED_CONNECTION_ID, state: "connected" }),
            ]);
            expect(connectDriver).toHaveBeenCalledOnce();
            expect(closeProvider).not.toHaveBeenCalled();
        });

        it("keeps MCP requests usable after asynchronous OIDC authentication failure and a fresh retry", async () => {
            const dial = pendingDial();
            const client = await startApplication();
            const failedId = await connect(client, OIDC_CONNECTION_STRING);
            const bus = await dial.started;
            expect(await listConnections(client)).toEqual([
                expect.objectContaining({ connectionId: failedId, state: "connecting" }),
            ]);

            const authError = new Error("Authentication failed");
            bus.emit("mongodb-oidc-plugin:auth-failed", { authStateId: "test-auth", error: authError.message });
            dial.result.reject(authError);
            await vi.waitFor(async () => {
                expect(await listConnections(client)).toEqual([
                    expect.objectContaining({ connectionId: failedId, state: "errored" }),
                ]);
            });
            expect(await count(client, failedId)).toMatchObject({ isError: true });
            expect(countDocuments).not.toHaveBeenCalled();

            const connectionId = await connect(client, OIDC_CONNECTION_STRING);
            const retryBus = connectDriver.mock.calls[1]?.[3];
            if (!retryBus) {
                throw new Error("Expected a fresh authentication event bus for the retry");
            }
            completeAuthentication(retryBus);
            await vi.waitFor(async () => {
                expect(await listConnections(client)).toEqual(
                    expect.arrayContaining([expect.objectContaining({ connectionId, state: "connected" })])
                );
            });
            expect(connectionId).not.toBe(failedId);
            expect(await count(client, connectionId)).toMatchObject({
                structuredContent: { count: EXPECTED_COUNT },
            });
            expect(connectDriver).toHaveBeenCalledTimes(2);
        });

        it("revokes a pending OIDC handle before the driver completes and returns a usable disconnect result", async () => {
            const dial = pendingDial();
            const client = await startApplication();
            const connectionId = await connect(client, OIDC_CONNECTION_STRING);
            await dial.started;
            expect(await listConnections(client)).toEqual([
                expect.objectContaining({ connectionId, state: "connecting" }),
            ]);

            const disconnect = client.callTool(
                { name: "disconnect", arguments: { connectionId } },
                { timeout: REQUEST_TIMEOUT_MS }
            );
            await vi.waitFor(async () => {
                expect(await listConnections(client)).toEqual([]);
            });
            expect(closeProvider).not.toHaveBeenCalled();
            const stale = await count(client, connectionId);
            expect(stale.isError).toBe(true);
            expect(JSON.stringify(stale.content)).toContain("does not exist or has expired");
            expect(countDocuments).not.toHaveBeenCalled();
            await client.ping({ timeout: REQUEST_TIMEOUT_MS });

            dial.result.resolve(provider);
            expect(await disconnect).toMatchObject({ structuredContent: { outcome: "removed" } });
            expect(closeProvider).toHaveBeenCalledOnce();
            expect(connectDriver).toHaveBeenCalledOnce();
            expect(await listConnections(client)).toEqual([]);
        });

        it("preserves a shared pending OIDC connection across client transport closure", async () => {
            const dial = pendingDial();
            const client = await startApplication();
            const connectionId = await connect(client, OIDC_CONNECTION_STRING);
            const bus = await dial.started;

            await client.close();
            clients.delete(client);
            expect(closeProvider).not.toHaveBeenCalled();
            dial.result.resolve(provider);
            completeAuthentication(bus);

            const replacementClient = await createClient();
            expect(await listConnections(replacementClient)).toEqual([
                expect.objectContaining({ connectionId, state: "connected" }),
            ]);
            expect(await count(replacementClient, connectionId)).toMatchObject({
                structuredContent: { count: EXPECTED_COUNT },
            });
            expect(connectDriver).toHaveBeenCalledOnce();

            const disconnected = await replacementClient.callTool(
                { name: "disconnect", arguments: { connectionId } },
                { timeout: REQUEST_TIMEOUT_MS }
            );
            expect(disconnected).toMatchObject({ structuredContent: { outcome: "removed" } });
            expect(closeProvider).toHaveBeenCalledOnce();
            expect(await listConnections(replacementClient)).toEqual([]);
        });
    }
);
