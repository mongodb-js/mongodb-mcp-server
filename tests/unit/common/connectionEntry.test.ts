import type { Mocked, MockedFunction } from "vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MongoServerError } from "mongodb";
import { NodeDriverServiceProvider } from "@mongosh/service-provider-node-driver";
import { CompositeLogger } from "../../../src/common/logging/index.js";
import { MCPConnectionManager } from "../../../src/common/connectionManager.js";
import {
    MCPConnectionStore,
    type ConnectionEntry,
    type ConnectionRegistry,
} from "../../../src/common/connectionRegistry.js";
import { DeviceId } from "../../../src/helpers/deviceId.js";
import { ErrorCodes, MongoDBError } from "../../../src/common/errors.js";
import { defaultTestConfig } from "../../integration/helpers.js";

vi.mock("@mongosh/service-provider-node-driver");

const MockNodeDriverServiceProvider = vi.mocked(NodeDriverServiceProvider);
const MockDeviceId = vi.mocked(DeviceId.create(new CompositeLogger()));

describe("ConnectionEntry with MCPConnectionManager", () => {
    const logger = new CompositeLogger();
    let registry: ConnectionRegistry;
    let mockDeviceId: Mocked<DeviceId>;

    beforeEach(() => {
        mockDeviceId = MockDeviceId;
        registry = new MCPConnectionStore({
            userConfig: defaultTestConfig,
            logger,
            deviceId: mockDeviceId,
            createConnectionManager: (): MCPConnectionManager =>
                new MCPConnectionManager(defaultTestConfig, logger, mockDeviceId),
        }).view();

        MockNodeDriverServiceProvider.connect = vi.fn().mockResolvedValue({} as unknown as NodeDriverServiceProvider);
        MockDeviceId.get = vi.fn().mockResolvedValue("test-device-id");
    });

    describe("connect", () => {
        const testCases: {
            connectionString: string;
            expectAppName: boolean;
            name: string;
        }[] = [
            {
                connectionString: "mongodb://localhost:27017",
                expectAppName: true,
                name: "db without appName",
            },
            {
                connectionString: "mongodb://localhost:27017?appName=CustomAppName",
                expectAppName: false,
                name: "db with custom appName",
            },
            {
                connectionString:
                    "mongodb+srv://test.mongodb.net/test?retryWrites=true&w=majority&appName=CustomAppName",
                expectAppName: false,
                name: "atlas db with custom appName",
            },
        ];

        for (const testCase of testCases) {
            it(`should update connection string for ${testCase.name}`, async () => {
                const entry = await registry.connect({
                    settings: { connectionString: testCase.connectionString },
                });
                expect(entry.getServiceProvider()).toBeDefined();

                const connectMock = MockNodeDriverServiceProvider.connect;
                expect(connectMock).toHaveBeenCalledOnce();
                const connectionString = connectMock.mock.calls[0]?.[0];
                if (testCase.expectAppName) {
                    // Check for the extended appName format: appName--deviceId--clientName
                    expect(connectionString).toContain("appName=MongoDB+MCP+Server+");
                    expect(connectionString).toContain("--test-device-id--");
                } else {
                    expect(connectionString).not.toContain("appName=MongoDB+MCP+Server");
                }
            });
        }

        it("should configure the proxy to use environment variables", async () => {
            const entry = await registry.connect({ settings: { connectionString: "mongodb://localhost" } });
            expect(entry.getServiceProvider()).toBeDefined();

            const connectMock = MockNodeDriverServiceProvider.connect;
            expect(connectMock).toHaveBeenCalledOnce();

            const connectionConfig = connectMock.mock.calls[0]?.[1];
            expect(connectionConfig?.proxy).toEqual({ useEnvironmentVariableProxies: true });
            expect(connectionConfig?.applyProxyToOIDC).toEqual(true);
        });

        it("should include client name when provided", async () => {
            await registry.connect({
                settings: { connectionString: "mongodb://localhost:27017" },
                clientName: "test-client",
            });

            const connectMock = MockNodeDriverServiceProvider.connect;
            expect(connectMock).toHaveBeenCalledOnce();
            const connectionString = connectMock.mock.calls[0]?.[0];

            // Should include the client name in the appName
            expect(connectionString).toContain("--test-device-id--test-client");
        });

        it("should use 'unknown' for client name when not provided", async () => {
            await registry.connect({ settings: { connectionString: "mongodb://localhost:27017" } });

            const connectMock = MockNodeDriverServiceProvider.connect;
            expect(connectMock).toHaveBeenCalledOnce();
            const connectionString = connectMock.mock.calls[0]?.[0];

            // Should use 'unknown' for client name when it was not provided
            expect(connectionString).toContain("--test-device-id--unknown");
        });
    });

    describe("isSearchSupported", () => {
        let getSearchIndexesMock: MockedFunction<() => unknown>;
        let createSearchIndexesMock: MockedFunction<() => unknown>;
        let insertOneMock: MockedFunction<() => unknown>;
        let listDatabasesMock: MockedFunction<() => unknown>;

        beforeEach(() => {
            getSearchIndexesMock = vi.fn();
            createSearchIndexesMock = vi.fn();
            insertOneMock = vi.fn();
            listDatabasesMock = vi.fn().mockResolvedValue({ databases: [] });

            MockNodeDriverServiceProvider.connect = vi.fn().mockResolvedValue({
                initialDb: "admin",
                getSearchIndexes: getSearchIndexesMock,
                createSearchIndexes: createSearchIndexesMock,
                insertOne: insertOneMock,
                dropDatabase: vi.fn().mockResolvedValue({}),
                listDatabases: listDatabasesMock,
            } as unknown as NodeDriverServiceProvider);
        });

        it("should return true if listing search indexes succeeds", async () => {
            getSearchIndexesMock.mockResolvedValue([]);
            insertOneMock.mockResolvedValue([]);
            createSearchIndexesMock.mockResolvedValue([]);

            const entry = await registry.connect({
                settings: { connectionString: "mongodb://localhost:27017" },
            });

            expect(await entry.isSearchSupported(logger)).toBeTruthy();
        });

        it("should return false when the server reports SearchNotEnabled", async () => {
            getSearchIndexesMock.mockRejectedValue(
                new MongoServerError({ message: "Search is not enabled", code: 31082, codeName: "SearchNotEnabled" })
            );

            const entry = await registry.connect({
                settings: { connectionString: "mongodb://localhost:27017" },
            });
            expect(await entry.isSearchSupported(logger)).toEqual(false);
        });

        it("should assume search is supported when the probe never sees SearchNotEnabled", async () => {
            getSearchIndexesMock.mockRejectedValue(new MongoServerError({ message: "not authorized on db", code: 13 }));

            const entry = await registry.connect({
                settings: { connectionString: "mongodb://localhost:27017" },
            });
            expect(await entry.isSearchSupported(logger)).toEqual(true);
            expect(await entry.isSearchSupported(logger)).toEqual(true);
            expect(getSearchIndexesMock).toHaveBeenCalledTimes(1);
        });
    });

    describe("assertSearchSupported", () => {
        let getSearchIndexesMock: MockedFunction<() => unknown>;
        let entry: ConnectionEntry;

        beforeEach(async () => {
            getSearchIndexesMock = vi.fn();

            MockNodeDriverServiceProvider.connect = vi.fn().mockResolvedValue({
                initialDb: "test",
                getSearchIndexes: getSearchIndexesMock,
                listDatabases: vi.fn().mockResolvedValue({ databases: [] }),
            } as unknown as NodeDriverServiceProvider);

            entry = await registry.connect({
                settings: { connectionString: "mongodb://localhost:27017" },
            });
        });

        it("should not throw if it is available", async () => {
            getSearchIndexesMock.mockResolvedValue([]);

            await expect(entry.assertSearchSupported(logger)).resolves.not.toThrow();
        });

        it("should throw if it is not supported", async () => {
            getSearchIndexesMock.mockRejectedValue(
                new MongoServerError({ message: "Search is not enabled", code: 31082, codeName: "SearchNotEnabled" })
            );

            await expect(entry.assertSearchSupported(logger)).rejects.toThrow(
                new MongoDBError(
                    ErrorCodes.AtlasSearchNotSupported,
                    "Atlas Search is not supported in the current cluster."
                )
            );
        });
    });
});
