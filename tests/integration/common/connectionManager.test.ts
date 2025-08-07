import {
    ConnectionManager,
    ConnectionManagerEvents,
    ConnectionStateConnected,
    ConnectionStringAuthType,
} from "../../../src/common/connectionManager.js";
import { describeWithMongoDB } from "../tools/mongodb/mongodbHelpers.js";
import { describe, beforeEach, expect, it, vi, afterEach } from "vitest";
import { config } from "../../../src/common/config.js";

describeWithMongoDB("Connection Manager", (integration) => {
    function connectionManager(): ConnectionManager {
        return integration.mcpServer().session.connectionManager;
    }

    afterEach(async () => {
        // disconnect on purpose doesn't change the state if it was failed to avoid losing
        // information in production.
        await connectionManager().disconnect();
        // for testing, force disconnecting AND setting the connection to closed to reset the
        // state of the connection manager
        connectionManager().changeState("connection-closed", { tag: "disconnected" });
    });

    describe("when successfully connected", () => {
        type ConnectionManagerSpies = {
            "connection-requested": (event: ConnectionManagerEvents["connection-requested"][0]) => void;
            "connection-succeeded": (event: ConnectionManagerEvents["connection-succeeded"][0]) => void;
            "connection-timed-out": (event: ConnectionManagerEvents["connection-timed-out"][0]) => void;
            "connection-closed": (event: ConnectionManagerEvents["connection-closed"][0]) => void;
            "connection-errored": (event: ConnectionManagerEvents["connection-errored"][0]) => void;
        };

        let connectionManagerSpies: ConnectionManagerSpies;

        beforeEach(async () => {
            connectionManagerSpies = {
                "connection-requested": vi.fn(),
                "connection-succeeded": vi.fn(),
                "connection-timed-out": vi.fn(),
                "connection-closed": vi.fn(),
                "connection-errored": vi.fn(),
            };

            for (const [event, spy] of Object.entries(connectionManagerSpies)) {
                connectionManager().on(event as keyof ConnectionManagerEvents, spy);
            }

            await connectionManager().connect({
                connectionString: integration.connectionString(),
                ...integration.mcpServer().userConfig.connectOptions,
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
            expect(connectionManagerSpies["connection-requested"]).toHaveBeenCalledOnce();
        });

        it("should notify that the connection was successful", () => {
            expect(connectionManagerSpies["connection-succeeded"]).toHaveBeenCalledOnce();
        });

        describe("when disconnects", () => {
            beforeEach(async () => {
                await connectionManager().disconnect();
            });

            it("should notify that it was disconnected before connecting", () => {
                expect(connectionManagerSpies["connection-closed"]).toHaveBeenCalled();
            });

            it("should be marked explicitly as disconnected", () => {
                expect(connectionManager().currentConnectionState.tag).toEqual("disconnected");
            });
        });

        describe("when reconnects", () => {
            beforeEach(async () => {
                await connectionManager().connect({
                    connectionString: integration.connectionString(),
                    ...integration.mcpServer().userConfig.connectOptions,
                });
            });

            it("should notify that it was disconnected before connecting", () => {
                expect(connectionManagerSpies["connection-closed"]).toHaveBeenCalled();
            });

            it("should notify that it was connected again", () => {
                expect(connectionManagerSpies["connection-succeeded"]).toHaveBeenCalled();
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
                        ...integration.mcpServer().userConfig.connectOptions,
                    });
                } catch (_error: unknown) {
                    void _error;
                }
            });

            it("should notify that it was disconnected before connecting", () => {
                expect(connectionManagerSpies["connection-closed"]).toHaveBeenCalled();
            });

            it("should notify that it failed connecting", () => {
                expect(connectionManagerSpies["connection-errored"]).toHaveBeenCalled();
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
        { connectionString: "mongodb://localhost:27017", connectionType: "scram" },
        { connectionString: "mongodb://localhost:27017?authMechanism=MONGODB-X509", connectionType: "x.509" },
        { connectionString: "mongodb://localhost:27017?authMechanism=GSSAPI", connectionType: "kerberos" },
        {
            connectionString: "mongodb://localhost:27017?authMechanism=PLAIN&authSource=$external",
            connectionType: "ldap",
        },
        { connectionString: "mongodb://localhost:27017?authMechanism=PLAIN", connectionType: "scram" },
        { connectionString: "mongodb://localhost:27017?authMechanism=MONGODB-OIDC", connectionType: "oidc-auth-flow" },
    ] as {
        connectionString: string;
        connectionType: ConnectionStringAuthType;
    }[];

    for (const { connectionString, connectionType } of testCases) {
        it(`infers ${connectionType} from ${connectionString}`, () => {
            const actualConnectionType = ConnectionManager.inferConnectionTypeFromSettings({
                connectionString,
                ...config.connectOptions,
            });

            expect(actualConnectionType).toBe(connectionType);
        });
    }
});
