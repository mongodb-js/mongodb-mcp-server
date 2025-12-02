import type { Mocked, MockedFunction } from "vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NodeDriverServiceProvider } from "@mongosh/service-provider-node-driver";
import { Session } from "../../../src/common/session.js";
import { CompositeLogger } from "../../../src/common/logger.js";
import { MCPConnectionManager } from "../../../src/common/connectionManager.js";
import { ExportsManager } from "../../../src/common/exportsManager.js";
import { DeviceId } from "../../../src/helpers/deviceId.js";
import { Keychain } from "../../../src/common/keychain.js";
import { VectorSearchEmbeddingsManager } from "../../../src/common/search/vectorSearchEmbeddingsManager.js";
import { ErrorCodes, MongoDBError } from "../../../src/common/errors.js";
import { defaultTestConfig } from "../../integration/helpers.js";

vi.mock("@mongosh/service-provider-node-driver");

const MockNodeDriverServiceProvider = vi.mocked(NodeDriverServiceProvider);
const MockDeviceId = vi.mocked(DeviceId.create(new CompositeLogger()));

describe("Session", () => {
    let session: Session;
    let mockDeviceId: Mocked<DeviceId>;

    beforeEach(() => {
        const logger = new CompositeLogger();

        mockDeviceId = MockDeviceId;
        const connectionManager = new MCPConnectionManager(defaultTestConfig, logger, mockDeviceId);

        session = new Session({
            userConfig: {
                ...defaultTestConfig,
                apiClientId: "test-client-id",
                apiBaseUrl: "https://api.test.com",
            },
            logger,
            exportsManager: ExportsManager.init(defaultTestConfig, logger),
            connectionManager: connectionManager,
            keychain: new Keychain(),
            vectorSearchEmbeddingsManager: new VectorSearchEmbeddingsManager(defaultTestConfig, connectionManager),
        });

        MockNodeDriverServiceProvider.connect = vi.fn().mockResolvedValue({} as unknown as NodeDriverServiceProvider);
        MockDeviceId.get = vi.fn().mockResolvedValue("test-device-id");
    });

    describe("connectToMongoDB", () => {
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
                await session.connectToMongoDB({
                    connectionString: testCase.connectionString,
                });
                expect(session.serviceProvider).toBeDefined();

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
            await session.connectToMongoDB({ connectionString: "mongodb://localhost" });
            expect(session.serviceProvider).toBeDefined();

            const connectMock = MockNodeDriverServiceProvider.connect;
            expect(connectMock).toHaveBeenCalledOnce();

            const connectionConfig = connectMock.mock.calls[0]?.[1];
            expect(connectionConfig?.proxy).toEqual({ useEnvironmentVariableProxies: true });
            expect(connectionConfig?.applyProxyToOIDC).toEqual(true);
        });

        it("should include client name when agent runner is set", async () => {
            session.setMcpClient({ name: "test-client", version: "1.0.0" });

            await session.connectToMongoDB({ connectionString: "mongodb://localhost:27017" });
            expect(session.serviceProvider).toBeDefined();

            const connectMock = MockNodeDriverServiceProvider.connect;
            expect(connectMock).toHaveBeenCalledOnce();
            const connectionString = connectMock.mock.calls[0]?.[0];

            // Should include the client name in the appName
            expect(connectionString).toContain("--test-device-id--test-client");
        });

        it("should use 'unknown' for client name when agent runner is not set", async () => {
            await session.connectToMongoDB({ connectionString: "mongodb://localhost:27017" });
            expect(session.serviceProvider).toBeDefined();

            const connectMock = MockNodeDriverServiceProvider.connect;
            expect(connectMock).toHaveBeenCalledOnce();
            const connectionString = connectMock.mock.calls[0]?.[0];

            // Should use 'unknown' for client name when agent runner is not set
            expect(connectionString).toContain("--test-device-id--unknown");
        });
    });

    describe("getSearchIndexAvailability", () => {
        let getSearchIndexesMock: MockedFunction<() => unknown>;
        let createSearchIndexesMock: MockedFunction<() => unknown>;
        let insertOneMock: MockedFunction<() => unknown>;

        beforeEach(() => {
            getSearchIndexesMock = vi.fn();
            createSearchIndexesMock = vi.fn();
            insertOneMock = vi.fn();

            MockNodeDriverServiceProvider.connect = vi.fn().mockResolvedValue({
                getSearchIndexes: getSearchIndexesMock,
                createSearchIndexes: createSearchIndexesMock,
                insertOne: insertOneMock,
                dropDatabase: vi.fn().mockResolvedValue({}),
            } as unknown as NodeDriverServiceProvider);
        });

        it("should return 'available' if listing search indexes succeed and create search indexes succeed", async () => {
            getSearchIndexesMock.mockResolvedValue([]);
            insertOneMock.mockResolvedValue([]);
            createSearchIndexesMock.mockResolvedValue([]);

            await session.connectToMongoDB({
                connectionString: "mongodb://localhost:27017",
            });

            expect(await session.isSearchSupported()).toBeTruthy();
        });

        it("should return false if listing search indexes fail with search error", async () => {
            getSearchIndexesMock.mockRejectedValue(new Error("SearchNotEnabled"));

            await session.connectToMongoDB({
                connectionString: "mongodb://localhost:27017",
            });
            expect(await session.isSearchSupported()).toEqual(false);
        });
    });

    describe("assertSearchSupported", () => {
        let getSearchIndexesMock: MockedFunction<() => unknown>;

        beforeEach(() => {
            getSearchIndexesMock = vi.fn();

            MockNodeDriverServiceProvider.connect = vi.fn().mockResolvedValue({
                getSearchIndexes: getSearchIndexesMock,
            } as unknown as NodeDriverServiceProvider);
        });

        it("should not throw if it is available", async () => {
            getSearchIndexesMock.mockResolvedValue([]);

            await session.connectToMongoDB({
                connectionString: "mongodb://localhost:27017",
            });

            await expect(session.assertSearchSupported()).resolves.not.toThrowError();
        });

        it("should throw if it is not supported", async () => {
            getSearchIndexesMock.mockRejectedValue(new Error("Not supported"));

            await session.connectToMongoDB({
                connectionString: "mongodb://localhost:27017",
            });

            await expect(session.assertSearchSupported()).rejects.toThrowError(
                new MongoDBError(
                    ErrorCodes.AtlasSearchNotSupported,
                    "Atlas Search is not supported in the current cluster."
                )
            );
        });
    });
});
