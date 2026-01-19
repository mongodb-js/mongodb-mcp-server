import { vi, it, describe, beforeEach, afterEach, afterAll, expect } from "vitest";
import { type CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MongoDBToolBase } from "../../../../src/tools/mongodb/mongodbTool.js";
import { type OperationType, type ToolClass } from "../../../../src/tools/tool.js";
import { type UserConfig } from "../../../../src/common/config/userConfig.js";
import { MCPConnectionManager } from "../../../../src/common/connectionManager.js";
import { Session } from "../../../../src/common/session.js";
import { CompositeLogger } from "../../../../src/common/logger.js";
import { DeviceId } from "../../../../src/helpers/deviceId.js";
import { ExportsManager } from "../../../../src/common/exportsManager.js";
import { InMemoryTransport } from "../../../../src/transports/inMemoryTransport.js";
import { Telemetry } from "../../../../src/telemetry/telemetry.js";
import { Server } from "../../../../src/server.js";
import { type ConnectionErrorHandler, connectionErrorHandler } from "../../../../src/common/connectionErrorHandler.js";
import { defaultTestConfig, expectDefined } from "../../helpers.js";
import { setupMongoDBIntegrationTest } from "./mongodbHelpers.js";
import { ErrorCodes } from "../../../../src/common/errors.js";
import { Keychain } from "../../../../src/common/keychain.js";
import { Elicitation } from "../../../../src/elicitation.js";
import * as MongoDbTools from "../../../../src/tools/mongodb/tools.js";
import { VectorSearchEmbeddingsManager } from "../../../../src/common/search/vectorSearchEmbeddingsManager.js";

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

class RandomTool extends MongoDBToolBase {
    name = "Random";
    static operationType: OperationType = "read";
    public description = "This is a tool.";
    public argsShape = {};
    protected async execute(): Promise<CallToolResult> {
        await this.ensureConnected();
        return { content: [{ type: "text", text: "Something" }] };
    }
}

class UnusableVoyageTool extends MongoDBToolBase {
    name = "UnusableVoyageTool";
    static operationType: OperationType = "read";
    public description = "This is a Voyage tool.";
    public argsShape = {};

    override verifyAllowed(): boolean {
        return false;
    }

    protected async execute(): Promise<CallToolResult> {
        await this.ensureConnected();
        return { content: [{ type: "text", text: "Something" }] };
    }
}

describe("MongoDBTool implementations", () => {
    const mdbIntegration = setupMongoDBIntegrationTest();

    let mcpClient: Client | undefined;
    let mcpServer: Server | undefined;
    let deviceId: DeviceId | undefined;

    async function cleanupAndStartServer(
        config: Partial<UserConfig> | undefined = {},
        toolConstructors: ToolClass[] = [...Object.values(MongoDbTools), RandomTool],
        errorHandler: ConnectionErrorHandler | undefined = connectionErrorHandler
    ): Promise<void> {
        await cleanup();
        const userConfig: UserConfig = { ...defaultTestConfig, telemetry: "disabled", ...config };
        const logger = new CompositeLogger();
        const exportsManager = ExportsManager.init(userConfig, logger);
        deviceId = DeviceId.create(logger);
        const connectionManager = new MCPConnectionManager(userConfig, logger, deviceId);
        const session = new Session({
            userConfig,
            logger,
            exportsManager,
            connectionManager,
            keychain: new Keychain(),
            vectorSearchEmbeddingsManager: new VectorSearchEmbeddingsManager(userConfig, connectionManager),
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

        const internalMcpServer = new McpServer({
            name: "test-server",
            version: "5.2.3",
        });
        const elicitation = new Elicitation({ server: internalMcpServer.server });

        mcpServer = new Server({
            session,
            userConfig,
            telemetry,
            mcpServer: internalMcpServer,
            connectionErrorHandler: errorHandler,
            elicitation,
            tools: toolConstructors,
        });

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
            await cleanupAndStartServer(
                defaultTestConfig,
                [...Object.values(MongoDbTools), RandomTool],
                injectedErrorHandler
            );
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
                await cleanupAndStartServer(
                    { connectionString: "mongodb://localhost:1234" },
                    [...Object.values(MongoDbTools), RandomTool],
                    injectedErrorHandler
                );
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
                    [...Object.values(MongoDbTools), RandomTool],
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

    describe("when a tool is not usable", () => {
        it("should not even be registered", async () => {
            await cleanupAndStartServer(
                { connectionString: mdbIntegration.connectionString(), indexCheck: true },
                [RandomTool, UnusableVoyageTool],
                injectedErrorHandler
            );
            const tools = await mcpClient?.listTools({});
            expect(tools?.tools).toHaveLength(1);
            expect(tools?.tools.find((tool) => tool.name === "UnusableVoyageTool")).toBeUndefined();
        });
    });

    describe("resolveTelemetryMetadata", () => {
        it("should return empty metadata when not connected", async () => {
            await cleanupAndStartServer();
            const tool = mcpServer?.tools.find((t) => t.name === "Random");
            expectDefined(tool);
            const randomTool = tool as RandomTool;

            const result: CallToolResult = { content: [{ type: "text", text: "test" }] };
            const metadata = randomTool["resolveTelemetryMetadata"](result, {} as never);

            expect(metadata).toEqual({});
            expect(metadata).not.toHaveProperty("project_id");
            expect(metadata).not.toHaveProperty("connection_auth_type");
            expect(metadata).not.toHaveProperty("connection_host_type");
        });

        it("should return metadata with connection_auth_type and host_type when connected via connection string", async () => {
            await cleanupAndStartServer({ connectionString: mdbIntegration.connectionString() });
            // Connect to MongoDB to set the connection state
            await mcpClient?.callTool({
                name: "Random",
                arguments: {},
            });

            const tool = mcpServer?.tools.find((t) => t.name === "Random");
            expectDefined(tool);
            const randomTool = tool as RandomTool;

            const result: CallToolResult = { content: [{ type: "text", text: "test" }] };
            const metadata = randomTool["resolveTelemetryMetadata"](result, {} as never);

            // When connected via connection string, connection_auth_type and host_type should be set
            // The actual value depends on the connection string, but they should be present
            expect(metadata).toHaveProperty("connection_auth_type");
            expect(typeof metadata.connection_auth_type).toBe("string");
            expect(metadata.connection_auth_type).toBe("scram");
            expect(metadata).toHaveProperty("connection_host_type");
            expect(typeof metadata.connection_host_type).toBe("string");
        });
    });
});
