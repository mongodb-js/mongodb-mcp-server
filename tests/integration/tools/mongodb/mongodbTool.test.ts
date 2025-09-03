import { vi, it, describe, beforeEach, afterEach, type MockedFunction, afterAll, expect } from "vitest";
import { type CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MongoDBToolBase } from "../../../../src/tools/mongodb/mongodbTool.js";
import { type OperationType } from "../../../../src/tools/tool.js";
import { defaultDriverOptions, type UserConfig } from "../../../../src/common/config.js";
import { MCPConnectionManager } from "../../../../src/common/connectionManager.js";
import { Session } from "../../../../src/common/session.js";
import { CompositeLogger } from "../../../../src/common/logger.js";
import { DeviceId } from "../../../../src/helpers/deviceId.js";
import { ExportsManager } from "../../../../src/common/exportsManager.js";
import { InMemoryTransport } from "../../inMemoryTransport.js";
import { Telemetry } from "../../../../src/telemetry/telemetry.js";
import { Server } from "../../../../src/server.js";
import { type ConnectionErrorHandler, connectionErrorHandler } from "../../../../src/common/connectionErrorHandler.js";
import { defaultTestConfig } from "../../helpers.js";
import { setupMongoDBIntegrationTest } from "./mongodbHelpers.js";
import { ErrorCodes } from "../../../../src/common/errors.js";

const injectedErrorHandler: ConnectionErrorHandler = (error) => {
    switch (error.code) {
        case ErrorCodes.NotConnectedToMongoDB:
            return {
                errorHandled: true,
                result: {
                    isError: true,
                    content: [
                        {
                            type: "text",
                            text: "Custom handler - Not connected",
                        },
                    ],
                },
            };
        case ErrorCodes.MisconfiguredConnectionString:
            return {
                errorHandled: true,
                result: {
                    isError: true,
                    content: [
                        {
                            type: "text",
                            text: "Custom handler - Misconfigured",
                        },
                    ],
                },
            };
    }
};

describe("MongoDBTool implementations", () => {
    const mdbIntegration = setupMongoDBIntegrationTest({ enterprise: false }, []);
    const executeStub: MockedFunction<() => Promise<CallToolResult>> = vi
        .fn()
        .mockResolvedValue({ content: [{ type: "text", text: "Something" }] });
    class RandomTool extends MongoDBToolBase {
        name = "Random";
        operationType: OperationType = "read";
        protected description = "This is a tool.";
        protected argsShape = {};
        public async execute(): Promise<CallToolResult> {
            await this.ensureConnected();
            return executeStub();
        }
    }

    let tool: RandomTool | undefined;
    let mcpClient: Client | undefined;
    let mcpServer: Server | undefined;
    let deviceId: DeviceId | undefined;

    async function cleanupAndStartServer(
        config: Partial<UserConfig> | undefined = {},
        errorHandler: ConnectionErrorHandler | undefined = connectionErrorHandler
    ): Promise<void> {
        await cleanup();
        const userConfig: UserConfig = { ...defaultTestConfig, telemetry: "disabled", ...config };
        const driverOptions = defaultDriverOptions;
        const logger = new CompositeLogger();
        const exportsManager = ExportsManager.init(userConfig, logger);
        deviceId = DeviceId.create(logger);
        const connectionManager = new MCPConnectionManager(userConfig, driverOptions, logger, deviceId);
        const session = new Session({
            apiBaseUrl: userConfig.apiBaseUrl,
            apiClientId: userConfig.apiClientId,
            apiClientSecret: userConfig.apiClientSecret,
            logger,
            exportsManager,
            connectionManager,
        });
        const telemetry = Telemetry.create(session, userConfig, deviceId);

        const clientTransport = new InMemoryTransport();
        const serverTransport = new InMemoryTransport();

        await serverTransport.start();
        await clientTransport.start();

        void clientTransport.output.pipeTo(serverTransport.input);
        void serverTransport.output.pipeTo(clientTransport.input);

        mcpClient = new Client(
            {
                name: "test-client",
                version: "1.2.3",
            },
            {
                capabilities: {},
            }
        );

        mcpServer = new Server({
            session,
            userConfig,
            telemetry,
            mcpServer: new McpServer({
                name: "test-server",
                version: "5.2.3",
            }),
            connectionErrorHandler: errorHandler,
        });

        tool = new RandomTool(session, userConfig, telemetry);
        tool.register(mcpServer);

        await mcpServer.connect(serverTransport);
        await mcpClient.connect(clientTransport);
    }

    async function cleanup(): Promise<void> {
        await mcpServer?.session.disconnect();
        await mcpClient?.close();
        mcpClient = undefined;

        await mcpServer?.close();
        mcpServer = undefined;

        deviceId?.close();
        deviceId = undefined;

        tool = undefined;
    }

    beforeEach(async () => {
        await cleanupAndStartServer();
    });

    afterEach(async () => {
        vi.clearAllMocks();
        if (mcpServer) {
            await mcpServer.session.disconnect();
        }
    });

    afterAll(cleanup);

    describe("when MCP is using default connection error handler", () => {
        describe("and comes across a MongoDB Error - NotConnectedToMongoDB", () => {
            it("should handle the error", async () => {
                const toolResponse = await mcpClient?.callTool({
                    name: "Random",
                    arguments: {},
                });
                expect(toolResponse?.isError).to.equal(true);
                expect(toolResponse?.content).toEqual(
                    expect.arrayContaining([
                        {
                            type: "text",
                            text: "You need to connect to a MongoDB instance before you can access its data.",
                        },
                    ])
                );
            });
        });

        describe("and comes across a MongoDB Error - MisconfiguredConnectionString", () => {
            it("should handle the error", async () => {
                // This is a misconfigured connection string
                await cleanupAndStartServer({ connectionString: "mongodb://localhost:1234" });
                const toolResponse = await mcpClient?.callTool({
                    name: "Random",
                    arguments: {},
                });
                expect(toolResponse?.isError).to.equal(true);
                expect(toolResponse?.content).toEqual(
                    expect.arrayContaining([
                        {
                            type: "text",
                            text: "The configured connection string is not valid. Please check the connection string and confirm it points to a valid MongoDB instance.",
                        },
                    ])
                );
            });
        });

        describe("and comes across any other error MongoDB Error - ForbiddenCollscan", () => {
            it("should not handle the error and let the static handling take over it", async () => {
                // This is a misconfigured connection string
                await cleanupAndStartServer({ connectionString: mdbIntegration.connectionString(), indexCheck: true });
                const toolResponse = await mcpClient?.callTool({
                    name: "find",
                    arguments: {
                        database: "db1",
                        collection: "coll1",
                    },
                });
                expect(toolResponse?.isError).to.equal(true);
                expect(toolResponse?.content).toEqual(
                    expect.arrayContaining([
                        {
                            type: "text",
                            text: "Index check failed: The find operation on \"db1.coll1\" performs a collection scan (COLLSCAN) instead of using an index. Consider adding an index for better performance. Use 'explain' tool for query plan analysis or 'collection-indexes' to view existing indexes. To disable this check, set MDB_MCP_INDEX_CHECK to false.",
                        },
                    ])
                );
            });
        });
    });

    describe("when MCP is using injected connection error handler", () => {
        beforeEach(async () => {
            await cleanupAndStartServer(defaultTestConfig, injectedErrorHandler);
        });

        describe("and comes across a MongoDB Error - NotConnectedToMongoDB", () => {
            it("should handle the error", async () => {
                const toolResponse = await mcpClient?.callTool({
                    name: "Random",
                    arguments: {},
                });
                expect(toolResponse?.isError).to.equal(true);
                expect(toolResponse?.content).toEqual(
                    expect.arrayContaining([
                        {
                            type: "text",
                            text: "Custom handler - Not connected",
                        },
                    ])
                );
            });
        });

        describe("and comes across a MongoDB Error - MisconfiguredConnectionString", () => {
            it("should handle the error", async () => {
                // This is a misconfigured connection string
                await cleanupAndStartServer({ connectionString: "mongodb://localhost:1234" }, injectedErrorHandler);
                const toolResponse = await mcpClient?.callTool({
                    name: "Random",
                    arguments: {},
                });
                expect(toolResponse?.isError).to.equal(true);
                expect(toolResponse?.content).toEqual(
                    expect.arrayContaining([
                        {
                            type: "text",
                            text: "Custom handler - Misconfigured",
                        },
                    ])
                );
            });
        });

        describe("and comes across any other error MongoDB Error - ForbiddenCollscan", () => {
            it("should not handle the error and let the static handling take over it", async () => {
                // This is a misconfigured connection string
                await cleanupAndStartServer(
                    { connectionString: mdbIntegration.connectionString(), indexCheck: true },
                    injectedErrorHandler
                );
                const toolResponse = await mcpClient?.callTool({
                    name: "find",
                    arguments: {
                        database: "db1",
                        collection: "coll1",
                    },
                });
                expect(toolResponse?.isError).to.equal(true);
                expect(toolResponse?.content).toEqual(
                    expect.arrayContaining([
                        {
                            type: "text",
                            text: "Index check failed: The find operation on \"db1.coll1\" performs a collection scan (COLLSCAN) instead of using an index. Consider adding an index for better performance. Use 'explain' tool for query plan analysis or 'collection-indexes' to view existing indexes. To disable this check, set MDB_MCP_INDEX_CHECK to false.",
                        },
                    ])
                );
            });
        });
    });
});
