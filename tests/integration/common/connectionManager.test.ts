import type { ConnectionManagerEvents, ConnectionStateConnected } from "../../../src/common/connectionManager.js";
import { getAuthType, type ConnectionStringAuthType } from "../../../src/common/connectionInfo.js";
import type { UserConfig } from "../../../src/common/config/userConfig.js";
import { describeWithMongoDB, waitUntilSearchIsReady } from "../tools/mongodb/mongodbHelpers.js";
import { describe, beforeEach, expect, it, vi, afterEach } from "vitest";
import type { MockInstance } from "vitest";
import { type TestConnectionManager } from "../../utils/index.js";

describeWithMongoDB("Connection Manager", (integration) => {
    function connectionManager(): TestConnectionManager {
        return integration.mcpServer().session.connectionManager as TestConnectionManager;
    }

    afterEach(async () => {
        // disconnect on purpose doesn't change the state if it was failed to avoid losing
        // information in production.
        await connectionManager().disconnect();
        // for testing, force disconnecting AND setting the connection to closed to reset the
        // state of the connection manager
        connectionManager().changeState("connection-close", { tag: "disconnected" });
    });

    describe("when successfully connected", () => {
        type ConnectionManagerSpies = {
            "connection-request": (event: ConnectionManagerEvents["connection-request"][0]) => void;
            "connection-success": (event: ConnectionManagerEvents["connection-success"][0]) => void;
            "connection-time-out": (event: ConnectionManagerEvents["connection-time-out"][0]) => void;
            "connection-close": (event: ConnectionManagerEvents["connection-close"][0]) => void;
            "connection-error": (event: ConnectionManagerEvents["connection-error"][0]) => void;
        };

        let connectionManagerSpies: ConnectionManagerSpies;

        beforeEach(async () => {
            connectionManagerSpies = {
                "connection-request": vi.fn(),
                "connection-success": vi.fn(),
                "connection-time-out": vi.fn(),
                "connection-close": vi.fn(),
                "connection-error": vi.fn(),
            };

            for (const [event, spy] of Object.entries(connectionManagerSpies)) {
                connectionManager().events.on(
                    event as keyof ConnectionManagerEvents,
                    spy as (...args: ConnectionManagerEvents[keyof ConnectionManagerEvents]) => void
                );
            }

            await connectionManager().connect({
                connectionString: integration.connectionString(),
            });
        });

        it("should be marked explicitly as connected", () => {
            expect(connectionManager().currentConnectionState.tag).toEqual("connected");
        });

        it("can query mongodb successfully", async () => {
            const connectionState = connectionManager().currentConnectionState as ConnectionStateConnected;
            const collections = await connectionState.serviceProvider.listCollections("admin");
            expect(collections).not.toBe([]);
        });

        it("should notify that the connection was requested", () => {
            expect(connectionManagerSpies["connection-request"]).toHaveBeenCalledOnce();
        });

        it("should notify that the connection was successful", () => {
            expect(connectionManagerSpies["connection-success"]).toHaveBeenCalledOnce();
        });

        describe("when disconnects", () => {
            beforeEach(async () => {
                await connectionManager().disconnect();
            });

            it("should notify that it was disconnected before connecting", () => {
                expect(connectionManagerSpies["connection-close"]).toHaveBeenCalled();
            });

            it("should be marked explicitly as disconnected", () => {
                expect(connectionManager().currentConnectionState.tag).toEqual("disconnected");
            });
        });

        describe("when reconnects", () => {
            beforeEach(async () => {
                await connectionManager().connect({
                    connectionString: integration.connectionString(),
                });
            });

            it("should notify that it was disconnected before connecting", () => {
                expect(connectionManagerSpies["connection-close"]).toHaveBeenCalled();
            });

            it("should notify that it was connected again", () => {
                expect(connectionManagerSpies["connection-success"]).toHaveBeenCalled();
            });

            it("should be marked explicitly as connected", () => {
                expect(connectionManager().currentConnectionState.tag).toEqual("connected");
            });
        });

        describe("when fails to connect to a new cluster", () => {
            beforeEach(async () => {
                try {
                    await connectionManager().connect({
                        connectionString: "mongodb://localhost:xxxxx",
                    });
                } catch (_error: unknown) {
                    void _error;
                }
            });

            it("should notify that it was disconnected before connecting", () => {
                expect(connectionManagerSpies["connection-close"]).toHaveBeenCalled();
            });

            it("should notify that it failed connecting", () => {
                expect(connectionManagerSpies["connection-error"]).toHaveBeenCalledWith({
                    tag: "errored",
                    connectedAtlasCluster: undefined,
                    connectionStringInfo: {
                        authType: "scram",
                        hostType: "unknown",
                    },
                    errorReason: "Unable to parse localhost:xxxxx with URL",
                });
            });

            it("should be marked explicitly as connected", () => {
                expect(connectionManager().currentConnectionState.tag).toEqual("errored");
            });
        });

        describe("when fails to connect to a new atlas cluster", () => {
            const atlas = {
                username: "",
                projectId: "",
                clusterName: "My Atlas Cluster",
                expiryDate: new Date(),
            };

            beforeEach(async () => {
                try {
                    await connectionManager().connect({
                        connectionString: "mongodb://localhost:xxxxx",
                        atlas,
                    });
                } catch (_error: unknown) {
                    void _error;
                }
            });

            it("should notify that it was disconnected before connecting", () => {
                expect(connectionManagerSpies["connection-close"]).toHaveBeenCalled();
            });

            it("should notify that it failed connecting", () => {
                expect(connectionManagerSpies["connection-error"]).toHaveBeenCalledWith({
                    tag: "errored",
                    connectedAtlasCluster: atlas,
                    connectionStringInfo: {
                        authType: "scram",
                        hostType: "atlas",
                    },
                    errorReason: "Unable to parse localhost:xxxxx with URL",
                });
            });

            it("should be marked explicitly as connected", () => {
                expect(connectionManager().currentConnectionState.tag).toEqual("errored");
            });
        });
    });

    describe("when disconnected", () => {
        it("should be marked explicitly as disconnected", () => {
            expect(connectionManager().currentConnectionState.tag).toEqual("disconnected");
        });
    });
});

const SEARCH_PROBE_ROOT_USER = { username: "root", password: "rootpw" };
const SEARCH_PROBE_SINGLE_DB_USER = { username: "singledb", password: "singledbpw" };
const SEARCH_PROBE_NO_USER_DB_USER = { username: "adminonly", password: "adminonlypw" };
const SEARCH_PROBE_USER_DB = "userdata";

describeWithMongoDB(
    "Connection Manager — isSearchSupported database probe",
    (integration) => {
        async function connectAndSpy(connectionString: string): Promise<{
            getSearchIndexesSpy: MockInstance;
            listDatabasesSpy: MockInstance;
            connectionState: ConnectionStateConnected;
        }> {
            const session = integration.mcpServer().session;
            await session.connectToMongoDB({ connectionString });

            const state = session.connectionManager.currentConnectionState;
            if (state.tag !== "connected") {
                throw new Error(`Expected state 'connected', got '${state.tag}'`);
            }

            return {
                getSearchIndexesSpy: vi.spyOn(state.serviceProvider, "getSearchIndexes"),
                listDatabasesSpy: vi.spyOn(state.serviceProvider, "listDatabases"),
                connectionState: state,
            };
        }

        beforeEach(async () => {
            await integration
                .mongoClient()
                .db(SEARCH_PROBE_USER_DB)
                .collection("fixture")
                .insertOne({ ensureDbExists: true });
        });

        afterEach(async () => {
            const session = integration.mcpServer().session;
            await session.disconnect();

            try {
                await integration.mongoClient().db(SEARCH_PROBE_USER_DB).dropDatabase();
            } catch {
                // best-effort cleanup
            }
        });

        describe("when the connected user has access to a single non-system database", () => {
            it("probes search support against that accessible database", async () => {
                const restrictedConnectionString = integration.connectionStringForUser({
                    username: SEARCH_PROBE_SINGLE_DB_USER.username,
                    password: SEARCH_PROBE_SINGLE_DB_USER.password,
                    authSource: "admin",
                    defaultDatabase: SEARCH_PROBE_USER_DB,
                });

                const { getSearchIndexesSpy, connectionState } = await connectAndSpy(restrictedConnectionString);

                const result = await connectionState.isSearchSupported(integration.mcpServer().session.logger);
                expect(result).toBe(false);

                expect(getSearchIndexesSpy).toHaveBeenCalledTimes(1);
                expect(getSearchIndexesSpy.mock.calls[0]?.[0]).toBe(SEARCH_PROBE_USER_DB);
                expect(getSearchIndexesSpy.mock.calls[0]?.[0]).not.toBe("#mongodb-mcp");
            });
        });

        describe("when the connected user has no accessible non-system databases", () => {
            it("still probes the hardcoded #mongodb-mcp database after the initial DB", async () => {
                const restrictedConnectionString = integration.connectionStringForUser({
                    username: SEARCH_PROBE_NO_USER_DB_USER.username,
                    password: SEARCH_PROBE_NO_USER_DB_USER.password,
                    authSource: "admin",
                });

                const { getSearchIndexesSpy, listDatabasesSpy, connectionState } =
                    await connectAndSpy(restrictedConnectionString);

                const result = await connectionState.isSearchSupported(integration.mcpServer().session.logger);
                expect(result).toBe(true);

                expect(listDatabasesSpy).toHaveBeenCalledTimes(1);
                const probedDatabases = getSearchIndexesSpy.mock.calls.map((call) => call[0] as string);
                expect(probedDatabases).toHaveLength(2);
                expect(probedDatabases[0]).toBe(connectionState.serviceProvider.mongoClient.options.dbName);
                expect(probedDatabases[1]).toBe("#mongodb-mcp");
            });
        });

        describe("when the connection default database is system database", () => {
            it("does not probe it and falls back to #mongodb-mcp", async () => {
                const connectionString = integration.connectionStringForUser({
                    username: SEARCH_PROBE_ROOT_USER.username,
                    password: SEARCH_PROBE_ROOT_USER.password,
                    authSource: "admin",
                    defaultDatabase: "admin",
                });

                const { getSearchIndexesSpy, listDatabasesSpy, connectionState } =
                    await connectAndSpy(connectionString);

                expect(connectionState.serviceProvider.mongoClient.options.dbName).toBe("admin");

                listDatabasesSpy.mockResolvedValue({
                    databases: [{ name: "admin" }, { name: "config" }, { name: "local" }],
                });

                const result = await connectionState.isSearchSupported(integration.mcpServer().session.logger);

                // False because when probing #mongodb-mcp, it will fail with SearchNotEnabled
                // because the instance we're connected to is not search-capable.
                expect(result).toBe(false);

                const probedDatabases = getSearchIndexesSpy.mock.calls.map((call) => call[0] as string);
                expect(probedDatabases).not.toContain("admin");
                expect(probedDatabases).toEqual(["#mongodb-mcp"]);
            });
        });

        describe("when listDatabases itself fails", () => {
            it("still probes using the service provider initial database first", async () => {
                const rootConnectionString = integration.connectionStringForUser({
                    username: SEARCH_PROBE_ROOT_USER.username,
                    password: SEARCH_PROBE_ROOT_USER.password,
                    authSource: "admin",
                });

                const { getSearchIndexesSpy, listDatabasesSpy, connectionState } =
                    await connectAndSpy(rootConnectionString);

                listDatabasesSpy.mockRejectedValueOnce(new Error("simulated failure"));

                const result = await connectionState.isSearchSupported(integration.mcpServer().session.logger);
                // False because when probing #mongodb-mcp, it will fail with SearchNotEnabled
                // because the instance we're connected to is not search-capable.
                expect(result).toBe(false);

                expect(listDatabasesSpy).toHaveBeenCalledTimes(1);
                expect(getSearchIndexesSpy).toHaveBeenCalledTimes(1);
                expect(getSearchIndexesSpy.mock.calls[0]?.[0]).toBe(connectionState.serviceProvider.initialDb);
            });
        });

        describe("caching behaviour", () => {
            it("only probes the server once across multiple isSearchSupported() calls", async () => {
                const rootConnectionString = integration.connectionStringForUser({
                    username: SEARCH_PROBE_ROOT_USER.username,
                    password: SEARCH_PROBE_ROOT_USER.password,
                    authSource: "admin",
                });

                const { getSearchIndexesSpy, listDatabasesSpy, connectionState } =
                    await connectAndSpy(rootConnectionString);

                const logger = integration.mcpServer().session.logger;
                const first = await connectionState.isSearchSupported(logger);
                const second = await connectionState.isSearchSupported(logger);
                const third = await connectionState.isSearchSupported(logger);

                expect(first).toBe(false);
                expect(first).toBe(second);
                expect(second).toBe(third);
                expect(getSearchIndexesSpy).toHaveBeenCalledTimes(1);
                expect(listDatabasesSpy).toHaveBeenCalledTimes(1);
            });
        });
    },
    {
        downloadOptions: {
            runner: true,
            downloadOptions: { enterprise: false },
            serverArgs: [],
            users: [
                {
                    username: SEARCH_PROBE_ROOT_USER.username,
                    password: SEARCH_PROBE_ROOT_USER.password,
                    roles: [{ role: "root", db: "admin" }],
                },
                {
                    username: SEARCH_PROBE_SINGLE_DB_USER.username,
                    password: SEARCH_PROBE_SINGLE_DB_USER.password,
                    roles: [{ role: "readWrite", db: SEARCH_PROBE_USER_DB }],
                },
                {
                    username: SEARCH_PROBE_NO_USER_DB_USER.username,
                    password: SEARCH_PROBE_NO_USER_DB_USER.password,
                    roles: [{ role: "read", db: "admin" }],
                },
            ],
        },
    }
);

describeWithMongoDB(
    "Connection Manager — isSearchSupported on search-capable cluster",
    (integration) => {
        beforeEach(async () => {
            await waitUntilSearchIsReady(integration.mongoClient());
        });

        afterEach(async () => {
            const cm = integration.mcpServer().session.connectionManager as TestConnectionManager;
            await cm.disconnect();
            cm.changeState("connection-close", { tag: "disconnected" });
        });

        it("returns true when Atlas Local Search is enabled", async () => {
            const session = integration.mcpServer().session;
            await session.connectToMongoDB({ connectionString: integration.connectionString() });

            const state = session.connectionManager.currentConnectionState;
            if (state.tag !== "connected") {
                throw new Error(`Expected state 'connected', got '${state.tag}'`);
            }

            const result = await state.isSearchSupported(integration.mcpServer().session.logger);
            expect(result).toBe(true);
        });
    },
    {
        downloadOptions: { search: true },
    }
);

describe("Connection Manager connection type inference", () => {
    const testCases = [
        { userConfig: {}, connectionString: "mongodb://localhost:27017", connectionType: "scram" },
        {
            userConfig: {},
            connectionString: "mongodb://localhost:27017?authMechanism=MONGODB-X509",
            connectionType: "x.509",
        },
        {
            userConfig: {},
            connectionString: "mongodb://localhost:27017?authMechanism=GSSAPI",
            connectionType: "kerberos",
        },
        {
            userConfig: {},
            connectionString: "mongodb://localhost:27017?authMechanism=PLAIN&authSource=$external",
            connectionType: "ldap",
        },
        { userConfig: {}, connectionString: "mongodb://localhost:27017?authMechanism=PLAIN", connectionType: "scram" },
        {
            userConfig: { transport: "stdio", browser: "firefox" },
            connectionString: "mongodb://localhost:27017?authMechanism=MONGODB-OIDC",
            connectionType: "oidc-auth-flow",
        },
        {
            userConfig: { transport: "http", httpHost: "127.0.0.1", browser: "ie6" },
            connectionString: "mongodb://localhost:27017?authMechanism=MONGODB-OIDC",
            connectionType: "oidc-auth-flow",
        },
        {
            userConfig: { transport: "http", httpHost: "0.0.0.0", browser: "ie6" },
            connectionString: "mongodb://localhost:27017?authMechanism=MONGODB-OIDC",
            connectionType: "oidc-device-flow",
        },
        {
            userConfig: { transport: "stdio" },
            connectionString: "mongodb://localhost:27017?authMechanism=MONGODB-OIDC",
            connectionType: "oidc-device-flow",
        },
    ] as {
        userConfig: Partial<UserConfig>;
        connectionString: string;
        connectionType: ConnectionStringAuthType;
    }[];

    for (const { userConfig, connectionString, connectionType } of testCases) {
        it(`infers ${connectionType} from ${connectionString}`, () => {
            const actualConnectionType = getAuthType(userConfig as UserConfig, connectionString);

            expect(actualConnectionType).toBe(connectionType);
        });
    }
});
