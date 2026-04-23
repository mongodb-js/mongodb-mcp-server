import { MCPConnectionManager } from "../../src/common/connectionManager.js";
import { ExportsManager } from "../../src/common/exportsManager.js";
import { CompositeLogger } from "../../src/common/logging/index.js";
import { DeviceId } from "../../src/helpers/deviceId.js";
import { Session } from "../../src/common/session.js";
import { defaultTestConfig, expectDefined, InMemoryLogger } from "./helpers.js";
import { describeWithMongoDB } from "./tools/mongodb/mongodbHelpers.js";
import { afterEach, describe, expect, it } from "vitest";
import type { LoggerBase, UserConfig } from "../../src/lib.js";
import { defaultCreateApiClient, Elicitation, Keychain, Telemetry } from "../../src/lib.js";
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
import { MockMetrics } from "../unit/mocks/metrics.js";

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
            metrics: new MockMetrics(),
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

    describe("log level clamping", () => {
        let server: Server | undefined;
        let inMemoryTransport: InMemoryTransport | undefined;

        afterEach(async () => {
            await inMemoryTransport?.close();
            await server?.close();
        });

        it("should clamp requested level to floor when client requests more verbose level", async () => {
            // Set floor to "warning" - client should not be able to go below this
            const config: UserConfig = {
                ...defaultTestConfig,
                mcpClientLogLevel: "warning",
            };

            const { server: s, transport } = await initServerWithTools([TestToolOne], config);
            server = s;
            inMemoryTransport = transport as InMemoryTransport;
            await server.connect(inMemoryTransport);

            // Verify initial level matches floor
            expect(server.mcpLogLevel).toBe("warning");

            const writer = inMemoryTransport.input.getWriter();

            // Client requests "debug" (more verbose/lower than floor) - should be clamped to "warning"
            await writer.write({
                jsonrpc: "2.0",
                id: 100,
                method: "logging/setLevel",
                params: { level: "debug" },
            });

            // Should be clamped to floor, not the requested level
            expect(server.mcpLogLevel).toBe("warning");

            // Client requests "info" (still more verbose than "warning") - should be clamped
            await writer.write({
                jsonrpc: "2.0",
                id: 101,
                method: "logging/setLevel",
                params: { level: "info" },
            });

            expect(server.mcpLogLevel).toBe("warning");

            writer.releaseLock();
        });

        it("should accept stricter levels unchanged", async () => {
            // Set floor to "info"
            const config: UserConfig = {
                ...defaultTestConfig,
                mcpClientLogLevel: "info",
            };

            const { server: s, transport } = await initServerWithTools([TestToolOne], config);
            server = s;
            inMemoryTransport = transport as InMemoryTransport;
            await server.connect(inMemoryTransport);

            // Verify initial level matches floor
            expect(server.mcpLogLevel).toBe("info");

            const writer = inMemoryTransport.input.getWriter();

            // Client requests "warning" (stricter) - should be accepted
            await writer.write({
                jsonrpc: "2.0",
                id: 200,
                method: "logging/setLevel",
                params: { level: "warning" },
            });

            expect(server.mcpLogLevel).toBe("warning");

            // Client requests "error" (even stricter) - should be accepted
            await writer.write({
                jsonrpc: "2.0",
                id: 201,
                method: "logging/setLevel",
                params: { level: "error" },
            });

            expect(server.mcpLogLevel).toBe("error");

            writer.releaseLock();
        });
    });
});
