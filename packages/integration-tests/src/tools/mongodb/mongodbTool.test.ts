import { vi, it, describe, beforeEach, afterEach, afterAll, expect } from "vitest";
import type { CallToolResult } from "@mongodb-js/mcp-types";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
    MongoDBToolBase,
    MCPConnectionManager,
    DeviceId,
    ExportsManager,
    ErrorCodes,
    MongoDBTools,
} from "@mongodb-js/mcp-tools-mongodb";
import {
    type OperationType,
    type UserConfig,
    CliSession,
    CliServer,
    connectionErrorHandler,
    type ConnectionErrorHandler,
    Elicitation,
} from "mongodb-mcp-server";
import type { AnyToolClass } from "@mongodb-js/mcp-core";
import { CompositeLogger, InMemoryTransport, Keychain } from "@mongodb-js/mcp-core";
import {
    createTestApiClient,
    defaultTestConfig,
    expectDefined,
    resetSessionAfterIntegrationTest,
    testServerMetadata,
} from "../../integrationHelpers.js";
import { MockMetrics } from "@mongodb-js/mcp-test-utils";
import { setupMongoDBIntegrationTest } from "../../mongodbHelpers.js";
import { AtlasTelemetry } from "@mongodb-js/mcp-atlas-telemetry";

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
    static toolName = "Random";
    static operationType: OperationType = "read";
    public description = "This is a tool.";
    public argsShape = {};
    protected async execute(): Promise<CallToolResult> {
        await this.ensureConnected();
        return { content: [{ type: "text", text: "Something" }] };
    }
}

class UnusableVoyageTool extends MongoDBToolBase {
    static toolName = "UnusableVoyageTool";
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
    let mcpServer: CliServer | undefined;
    let deviceId: DeviceId | undefined;

    async function cleanupAndStartServer(
        config: Partial<UserConfig> | undefined = {},
        toolConstructors: AnyToolClass[] = [...Object.values(MongoDBTools), RandomTool],
        errorHandler: ConnectionErrorHandler | undefined = connectionErrorHandler
    ): Promise<void> {
        await cleanup();
        const userConfig: UserConfig = { ...defaultTestConfig, telemetry: "disabled", ...config };
        const logger = new CompositeLogger();
        const exportsManager = ExportsManager.init({ options: userConfig, logger: logger });
        deviceId = DeviceId.create(logger);
        const connectionManager = new MCPConnectionManager({
            logger: logger,
            deviceId: deviceId,
            serverMetadata: testServerMetadata,
            connectionInfo: userConfig,
        });
        const session = new CliSession({
            userConfig,
            logger,
            exportsManager,
            connectionManager,
            keychain: new Keychain(),
            connectionErrorHandler: errorHandler,
            apiClient: createTestApiClient({
                baseUrl: userConfig.apiBaseUrl,
                serverMetadata: { mcpServerName: "test", version: "1" },
                logger,
                clientId: userConfig.apiClientId,
                clientSecret: userConfig.apiClientSecret,
            }),
        });

        const telemetry = AtlasTelemetry.create({
            logger,
            deviceId,
            apiClient: session.apiClient,
            keychain: session.keychain,
            enabled: false,
            serverMetadata: {
                mcpServerName: "test-server",
                version: "1.0",
            },
        });

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

        mcpServer = new CliServer({
            session,
            telemetry,
            mcpServer: internalMcpServer,
            connectionErrorHandler: errorHandler,
            elicitation,
            tools: toolConstructors,
            metrics: new MockMetrics(),
            serverMetadata: {
                mcpServerName: "test-server",
                version: "1.0",
                engines: {
                    node: "20.0.0",
                },
            },
        });

        await mcpServer.connect(serverTransport);
        await mcpClient.connect(clientTransport);
    }

    async function cleanup(): Promise<void> {
        if (mcpServer) {
            await resetSessionAfterIntegrationTest(mcpServer);
        }
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
            await resetSessionAfterIntegrationTest(mcpServer);
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
                [...Object.values(MongoDBTools), RandomTool],
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
                    [...Object.values(MongoDBTools), RandomTool],
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
                    [...Object.values(MongoDBTools), RandomTool],
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

    describe("getOperationOptions", () => {
        it("should return only signal when maxTimeMS is not configured", async () => {
            await cleanupAndStartServer();
            const tool = mcpServer?.tools.find((t) => t.name === "Random");
            expectDefined(tool);
            const randomTool = tool as RandomTool;

            const signal = AbortSignal.timeout(5000);
            const options = randomTool["getOperationOptions"](signal);

            expect(options).toEqual({ signal });
            expect(options).not.toHaveProperty("maxTimeMS");
        });

        it("should return signal and maxTimeMS when maxTimeMS is configured", async () => {
            await cleanupAndStartServer({ maxTimeMS: 30000 });
            const tool = mcpServer?.tools.find((t) => t.name === "Random");
            expectDefined(tool);
            const randomTool = tool as RandomTool;

            const signal = AbortSignal.timeout(5000);
            const options = randomTool["getOperationOptions"](signal);

            expect(options).toEqual({ signal, maxTimeMS: 30000 });
        });

        it("should return only maxTimeMS when signal is undefined", async () => {
            await cleanupAndStartServer({ maxTimeMS: 15000 });
            const tool = mcpServer?.tools.find((t) => t.name === "Random");
            expectDefined(tool);
            const randomTool = tool as RandomTool;

            const options = randomTool["getOperationOptions"](undefined);

            expect(options).toEqual({ maxTimeMS: 15000 });
        });

        it("should return empty object when neither signal nor maxTimeMS is provided", async () => {
            await cleanupAndStartServer();
            const tool = mcpServer?.tools.find((t) => t.name === "Random");
            expectDefined(tool);
            const randomTool = tool as RandomTool;

            const options = randomTool["getOperationOptions"](undefined);

            expect(options).toEqual({});
        });

        it("should treat maxTimeMS of 0 as a valid value", async () => {
            await cleanupAndStartServer({ maxTimeMS: 0 });
            const tool = mcpServer?.tools.find((t) => t.name === "Random");
            expectDefined(tool);
            const randomTool = tool as RandomTool;

            const signal = AbortSignal.timeout(5000);
            const options = randomTool["getOperationOptions"](signal);

            expect(options).toEqual({ signal, maxTimeMS: 0 });
        });

        it("should return maxTimeMS 0 without signal", async () => {
            await cleanupAndStartServer({ maxTimeMS: 0 });
            const tool = mcpServer?.tools.find((t) => t.name === "Random");
            expectDefined(tool);
            const randomTool = tool as RandomTool;

            const options = randomTool["getOperationOptions"](undefined);

            expect(options).toEqual({ maxTimeMS: 0 });
        });
    });
});
