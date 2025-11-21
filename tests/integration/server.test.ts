import { MCPConnectionManager } from "../../src/common/connectionManager.js";
import { ExportsManager } from "../../src/common/exportsManager.js";
import { CompositeLogger } from "../../src/common/logger.js";
import { DeviceId } from "../../src/helpers/deviceId.js";
import { Session } from "../../src/common/session.js";
import {
    defaultTestConfig,
    expectDefined,
    validateThrowsForInvalidArguments,
    validateToolMetadata,
} from "./helpers.js";
import { describeWithMongoDB } from "./tools/mongodb/mongodbHelpers.js";
import { describe, expect, it } from "vitest";
import { Elicitation, Keychain, Telemetry } from "../../src/lib.js";
import { VectorSearchEmbeddingsManager } from "../../src/common/search/vectorSearchEmbeddingsManager.js";
import { defaultCreateAtlasLocalClient } from "../../src/common/atlasLocal.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Server } from "../../src/server.js";
import { connectionErrorHandler } from "../../src/common/connectionErrorHandler.js";
import { InMemoryTransport } from "./inMemoryTransport.js";
import type { UserConfig } from "../../src/common/config/userConfig.js";
import { type OperationType, ToolBase, type ToolCategory } from "../../src/tools/tool.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { TelemetryToolMetadata } from "../../src/telemetry/types.js";
import { AllTools } from "../../src/tools/index.js";
class TestToolOne extends ToolBase {
    public internalName = "test-tool-one";
    public category: ToolCategory = "mongodb";
    public operationType: OperationType = "delete";
    protected internalDescription = "A test tool one for verification tests";
    protected argsShape = {};
    protected async execute(): Promise<CallToolResult> {
        return Promise.resolve({
            content: [
                {
                    type: "text",
                    text: "Test tool executed successfully",
                },
            ],
        });
    }
    protected resolveTelemetryMetadata(): TelemetryToolMetadata {
        return {};
    }
}

class TestToolTwo extends ToolBase {
    public internalName = "test-tool-two";
    public category: ToolCategory = "mongodb";
    public operationType: OperationType = "delete";
    protected internalDescription = "A test tool two for verification tests";
    protected argsShape = {};
    protected async execute(): Promise<CallToolResult> {
        return Promise.resolve({
            content: [
                {
                    type: "text",
                    text: "Test tool executed successfully",
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
                expect(tools.tools.some((tool) => tool.name === "insert-one")).toBe(false);
                expect(tools.tools.some((tool) => tool.name === "update-many")).toBe(false);
                expect(tools.tools.some((tool) => tool.name === "delete-one")).toBe(false);
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

    describeWithMongoDB(
        "Tool with overridden metadata",
        (integration) => {
            validateToolMetadata(integration, "new-connect", "new connect tool description", "connect", [
                {
                    name: "connectionString",
                    description: "MongoDB connection string (in the mongodb:// or mongodb+srv:// format)",
                    type: "string",
                    required: true,
                },
            ]);

            validateThrowsForInvalidArguments(integration, "new-connect", [{}, { connectionString: 123 }]);

            it("should not have overridden connect tool registered", async () => {
                const { tools } = await integration.mcpClient().listTools();
                const tool = tools.find((tool) => tool.name === "connect");
                expect(tool).toBeUndefined();
            });
        },
        {
            getUserConfig() {
                return {
                    ...defaultTestConfig,
                    toolMetadataOverrides: {
                        connect: {
                            name: "new-connect",
                            description: "new connect tool description",
                        },
                    },
                };
            },
        }
    );

    describe("when toolMetadataOverrides leads to tool name collision", () => {
        it.each([
            {
                config: {
                    toolMetadataOverrides: {
                        "list-databases": { name: "my-tool" },
                        "list-collections": { name: "my-tool" },
                    },
                },
                additionalTools: [],
            },
            {
                config: {
                    toolMetadataOverrides: {
                        "list-databases": { name: "list-collections" },
                    },
                },
                additionalTools: [],
            },
            {
                config: {
                    toolMetadataOverrides: {
                        "test-tool-one": {
                            name: "connect",
                        },
                    },
                },
                additionalTools: [TestToolOne, TestToolTwo],
            },
            {
                config: {
                    toolMetadataOverrides: {
                        "test-tool-one": {
                            name: "test-tool-two",
                        },
                    },
                },
                additionalTools: [TestToolOne, TestToolTwo],
            },
        ] as { config: Partial<UserConfig>; additionalTools: (new () => ToolBase)[] }[])(
            "should throw an error when tool names collide due to overrides - %",
            async ({ config, additionalTools }) => {
                const userConfig: UserConfig = {
                    ...defaultTestConfig,
                    ...config,
                };
                const logger = new CompositeLogger();
                const deviceId = DeviceId.create(logger);
                const connectionManager = new MCPConnectionManager(userConfig, logger, deviceId);
                const exportsManager = ExportsManager.init(userConfig, logger);

                const session = new Session({
                    userConfig: userConfig,
                    logger,
                    exportsManager,
                    connectionManager,
                    keychain: Keychain.root,
                    vectorSearchEmbeddingsManager: new VectorSearchEmbeddingsManager(userConfig, connectionManager),
                    atlasLocalClient: await defaultCreateAtlasLocalClient(),
                });

                const telemetry = Telemetry.create(session, userConfig, deviceId);
                const mcpServerInstance = new McpServer({ name: "test", version: "1.0" });
                const elicitation = new Elicitation({ server: mcpServerInstance.server });

                const server = new Server({
                    session,
                    userConfig: userConfig,
                    telemetry,
                    mcpServer: mcpServerInstance,
                    elicitation,
                    connectionErrorHandler,
                    tools: [...AllTools, ...additionalTools],
                });

                const transport = new InMemoryTransport();

                // We expect this to fail with our new guardrail
                await expect(server.connect(transport)).rejects.toThrow(/Tool name collision detected/);
            }
        );
    });
});
