import type {
    ConnectionManagerEvents,
    ConnectionStateConnected,
    ConnectionStringAuthType,
    TestConnectionManager,
} from "../../../src/common/connectionManager.js";
import { MCPConnectionManager } from "../../../src/common/connectionManager.js";
import type { UserConfig } from "../../../src/common/config.js";
import { describeWithMongoDB } from "../tools/mongodb/mongodbHelpers.js";
import { describe, beforeEach, expect, it, vi, afterEach } from "vitest";

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
                connectionManager().events.on(event as keyof ConnectionManagerEvents, spy);
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
                    connectionStringAuthType: "scram",
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
                    connectionStringAuthType: "scram",
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
            const actualConnectionType = MCPConnectionManager.inferConnectionTypeFromSettings(
                userConfig as UserConfig,
                {
                    connectionString,
                }
            );

            expect(actualConnectionType).toBe(connectionType);
        });
    }
});
