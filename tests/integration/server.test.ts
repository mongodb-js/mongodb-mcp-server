import { MCPConnectionManager } from "../../src/common/connectionManager.js";
import { ExportsManager } from "../../src/common/exportsManager.js";
import { CompositeLogger } from "../../src/common/logger.js";
import { DeviceId } from "../../src/helpers/deviceId.js";
import { Session } from "../../src/common/session.js";
import { defaultTestConfig, expectDefined, InMemoryLogger } from "./helpers.js";
import { describeWithMongoDB } from "./tools/mongodb/mongodbHelpers.js";
import { afterEach, describe, expect, it } from "vitest";
import type { LoggerBase, UserConfig } from "../../src/lib.js";
import { defaultCreateApiClient, Elicitation, Keychain, Telemetry } from "../../src/lib.js";
import { VectorSearchEmbeddingsManager } from "../../src/common/search/vectorSearchEmbeddingsManager.js";
import { defaultCreateAtlasLocalClient } from "../../src/common/atlasLocal.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Server } from "../../src/server.js";
import { connectionErrorHandler } from "../../src/common/connectionErrorHandler.js";
import { type OperationType, ToolBase, type ToolCategory, type ToolClass } from "../../src/tools/tool.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { TelemetryToolMetadata } from "../../src/telemetry/types.js";
import { InMemoryTransport } from "../../src/transports/inMemoryTransport.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { TRANSPORT_PAYLOAD_LIMITS } from "../../src/transports/constants.js";

class TestToolOne extends ToolBase {
    static toolName = "test-tool-one";
    public description = "A test tool one for verification tests";
    static category: ToolCategory = "mongodb";
    static operationType: OperationType = "delete";
    public argsShape = {};
    protected async execute(): Promise<CallToolResult> {
        return Promise.resolve({
            content: [
                {
                    type: "text",
                    text: "Test tool one executed successfully",
                },
            ],
        });
    }
    protected resolveTelemetryMetadata(): TelemetryToolMetadata {
        return {};
    }
}

class TestToolTwo extends ToolBase {
    static toolName = "test-tool-two";
    public description = "A test tool two for verification tests";
    static category: ToolCategory = "mongodb";
    static operationType: OperationType = "delete";
    public argsShape = {};
    protected async execute(): Promise<CallToolResult> {
        return Promise.resolve({
            content: [
                {
                    type: "text",
                    text: "Test tool two executed successfully",
                },
            ],
        });
    }
    protected resolveTelemetryMetadata(): TelemetryToolMetadata {
        return {};
    }
}

describe("Server integration test", () => {
    describeWithMongoDB(
        "without atlas",
        (integration) => {
            it("should return positive number of tools and have no atlas tools", async () => {
                const tools = await integration.mcpClient().listTools();
                expectDefined(tools);
                expect(tools.tools.length).toBeGreaterThan(0);

                const atlasTools = tools.tools.filter(
                    (tool) => tool.name.startsWith("atlas-") && !tool.name.startsWith("atlas-local-")
                );
                expect(atlasTools.length).toBeLessThanOrEqual(0);
            });
            it("should include _meta with transport info all tools in tool listing", async () => {
                const tools = await integration.mcpClient().listTools();
                expectDefined(tools);
                expect(tools.tools.length).toBeGreaterThan(0);
                expect(tools.tools.every((tool) => tool._meta)).toBe(true);
                expect(tools.tools.every((tool) => tool._meta?.["com.mongodb/transport"] === "stdio")).toBe(true);
                expect(
                    tools.tools.every(
                        (tool) => tool._meta?.["com.mongodb/maxRequestPayloadBytes"] === TRANSPORT_PAYLOAD_LIMITS.stdio
                    )
                ).toBe(true);
            });
        },
        {
            getUserConfig: () => ({
                ...defaultTestConfig,
                apiClientId: undefined,
                apiClientSecret: undefined,
            }),
        }
    );

    describeWithMongoDB(
        "with atlas",
        (integration) => {
            describe("list capabilities", () => {
                it("should return positive number of tools and have some atlas tools", async () => {
                    const tools = await integration.mcpClient().listTools();
                    expectDefined(tools);
                    expect(tools.tools.length).toBeGreaterThan(0);

                    const atlasTools = tools.tools.filter((tool) => tool.name.startsWith("atlas-"));
                    expect(atlasTools.length).toBeGreaterThan(0);
                });

                it("should return no prompts", async () => {
                    await expect(() => integration.mcpClient().listPrompts()).rejects.toMatchObject({
                        message: "MCP error -32601: Method not found",
                    });
                });

                it("should return capabilities", () => {
                    const capabilities = integration.mcpClient().getServerCapabilities();
                    expectDefined(capabilities);
                    expectDefined(capabilities?.logging);
                    expectDefined(capabilities?.completions);
                    expectDefined(capabilities?.tools);
                    expectDefined(capabilities?.resources);
                    expect(capabilities.experimental).toBeUndefined();
                    expect(capabilities.prompts).toBeUndefined();
                });
            });
        },
        {
            getUserConfig: () => ({
                ...defaultTestConfig,
                apiClientId: "test",
                apiClientSecret: "test",
            }),
        }
    );

    describeWithMongoDB(
        "with read-only mode",
        (integration) => {
            it("should only register read and metadata operation tools when read-only mode is enabled", async () => {
                const tools = await integration.mcpClient().listTools();
                expectDefined(tools);
                expect(tools.tools.length).toBeGreaterThan(0);

                // Check that we have some tools available (the read and metadata ones)
                expect(tools.tools.some((tool) => tool.name === "find")).toBe(true);
                expect(tools.tools.some((tool) => tool.name === "collection-schema")).toBe(true);
                expect(tools.tools.some((tool) => tool.name === "list-databases")).toBe(true);
                expect(tools.tools.some((tool) => tool.name === "atlas-list-orgs")).toBe(true);
                expect(tools.tools.some((tool) => tool.name === "atlas-list-projects")).toBe(true);

                // Check that non-read tools are NOT available
                expect(tools.tools.some((tool) => tool.name === "insert-many")).toBe(false);
                expect(tools.tools.some((tool) => tool.name === "update-many")).toBe(false);
                expect(tools.tools.some((tool) => tool.name === "delete-many")).toBe(false);
                expect(tools.tools.some((tool) => tool.name === "drop-collection")).toBe(false);
            });
        },
        {
            getUserConfig: () => ({
                ...defaultTestConfig,
                readOnly: true,
                apiClientId: "test",
                apiClientSecret: "test",
            }),
        }
    );

    const initServerWithTools = async (
        tools: ToolClass[],
        config: UserConfig = defaultTestConfig,
        loggers: LoggerBase[] = []
    ): Promise<{ server: Server; transport: Transport }> => {
        const logger = new CompositeLogger(...loggers);
        const deviceId = DeviceId.create(logger);
        const connectionManager = new MCPConnectionManager(config, logger, deviceId);
        const exportsManager = ExportsManager.init(config, logger);
        const session = new Session({
            userConfig: config,
            logger,
            exportsManager,
            connectionManager,
            keychain: Keychain.root,
            connectionErrorHandler,
            vectorSearchEmbeddingsManager: new VectorSearchEmbeddingsManager(config, connectionManager),
            atlasLocalClient: await defaultCreateAtlasLocalClient({ logger }),
            apiClient: defaultCreateApiClient(
                {
                    baseUrl: config.apiBaseUrl,
                    credentials: {
                        clientId: config.apiClientId,
                        clientSecret: config.apiClientSecret,
                    },
                },
                logger
            ),
        });

        const telemetry = Telemetry.create(session, config, deviceId);
        const mcpServerInstance = new McpServer({ name: "test", version: "1.0" });
        const elicitation = new Elicitation({ server: mcpServerInstance.server });

        const server = new Server({
            session,
            userConfig: config,
            telemetry,
            mcpServer: mcpServerInstance,
            elicitation,
            connectionErrorHandler,
            tools: [...tools],
        });

        const transport = new InMemoryTransport();

        return { transport, server };
    };

    describe("with additional tools", () => {
        let server: Server | undefined;
        let transport: Transport | undefined;

        afterEach(async () => {
            await transport?.close();
            await server?.close();
        });

        it("should start server with only the tools provided", async () => {
            ({ server, transport } = await initServerWithTools([TestToolOne]));
            await server.connect(transport);
            expect(server.tools).toHaveLength(1);
        });

        it("should throw error before starting when provided tools have name conflict", async () => {
            ({ server, transport } = await initServerWithTools([
                TestToolOne,
                class TestToolTwoButOne extends TestToolTwo {
                    public name = "test-tool-one";
                },
            ]));
            await expect(server.connect(transport)).rejects.toThrow(/Tool test-tool-one is already registered/);
        });
    });

    describe("config validation", () => {
        let server: Server | undefined;
        let transport: Transport | undefined;

        afterEach(async () => {
            await transport?.close();
            await server?.close();
        });

        it("should warn when not using https for apiBaseUrl", async () => {
            const logger = new InMemoryLogger(Keychain.root);
            const config: UserConfig = {
                ...defaultTestConfig,
                apiBaseUrl: "http://localhost:8080",
                apiClientId: "test",
                apiClientSecret: "test",
            };

            ({ server, transport } = await initServerWithTools([TestToolOne], config, [logger]));
            await server.connect(transport);

            const warningMessages = logger.messages.filter(
                (msg) =>
                    msg.level === "warning" &&
                    msg.payload.message.includes(
                        "apiBaseUrl is configured to use http:, which is not secure. It is strongly recommended to use HTTPS for secure communication."
                    )
            );
            expect(warningMessages.length).toBeGreaterThan(0);
        });
    });
});
