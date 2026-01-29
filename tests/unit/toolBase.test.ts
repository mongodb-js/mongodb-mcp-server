import type { Mock } from "vitest";
import { describe, it, expect, vi, beforeEach, type MockedFunction } from "vitest";
import type { ZodRawShape } from "zod";
import { z } from "zod";
import type { OperationType, ToolCategory, ToolConstructorParams, ToolArgs } from "../../src/tools/tool.js";
import { ToolBase } from "../../src/tools/tool.js";
import type { CallToolResult, ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import type { Session } from "../../src/common/session.js";
import type { UserConfig } from "../../src/common/config/userConfig.js";
import type { Telemetry } from "../../src/telemetry/telemetry.js";
import type { Elicitation } from "../../src/elicitation.js";
import type { CompositeLogger } from "../../src/common/logger.js";
import type { ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Server } from "../../src/server.js";
import type { TelemetryToolMetadata, ToolEvent } from "../../src/telemetry/types.js";
import type { PreviewFeature } from "../../src/common/schemas.js";
import { UIRegistry } from "../../src/ui/registry/index.js";
import { TRANSPORT_PAYLOAD_LIMITS } from "../../src/transports/constants.js";
import { expectDefined } from "../integration/helpers.js";

describe("ToolBase", () => {
    let mockSession: Session;
    let mockLogger: CompositeLogger;
    let mockLoggerWarning: ReturnType<typeof vi.fn>;
    let mockConfig: UserConfig;
    let mockTelemetry: Telemetry;
    let mockElicitation: Elicitation;
    let mockRequestConfirmation: MockedFunction<(message: string) => Promise<boolean>>;
    let testTool: TestTool;

    beforeEach(() => {
        mockLoggerWarning = vi.fn();
        mockLogger = {
            info: vi.fn(),
            debug: vi.fn(),
            warning: mockLoggerWarning,
            error: vi.fn(),
        } as unknown as CompositeLogger;

        mockSession = {
            logger: mockLogger,
        } as Session;

        mockConfig = {
            confirmationRequiredTools: [],
            previewFeatures: [],
            disabledTools: [],
        } as unknown as UserConfig;

        mockTelemetry = {
            isTelemetryEnabled: () => true,
            emitEvents: vi.fn(),
        } as unknown as Telemetry;

        mockRequestConfirmation = vi.fn();
        mockElicitation = {
            requestConfirmation: mockRequestConfirmation,
        } as unknown as Elicitation;

        const constructorParams: ToolConstructorParams = {
            category: TestTool.category,
            operationType: TestTool.operationType,
            session: mockSession,
            config: mockConfig,
            telemetry: mockTelemetry,
            elicitation: mockElicitation,
            uiRegistry: new UIRegistry(),
        };

        testTool = new TestTool(constructorParams);
    });

    describe("verifyConfirmed", () => {
        it("should return true when tool is not in confirmationRequiredTools list", async () => {
            mockConfig.confirmationRequiredTools = ["other-tool", "another-tool"];

            const args = { param1: "test" };
            const result = await testTool.verifyConfirmed(args);

            expect(result).toBe(true);
            expect(mockRequestConfirmation).not.toHaveBeenCalled();
        });

        it("should return true when confirmationRequiredTools list is empty", async () => {
            mockConfig.confirmationRequiredTools = [];

            const args = { param1: "test" };
            const result = await testTool.verifyConfirmed(args);

            expect(result).toBe(true);
            expect(mockRequestConfirmation).not.toHaveBeenCalled();
        });

        it("should call requestConfirmation when tool is in confirmationRequiredTools list", async () => {
            mockConfig.confirmationRequiredTools = ["test-tool"];
            mockRequestConfirmation.mockResolvedValue(true);

            const args = { param1: "test", param2: 42 };
            const result = await testTool.verifyConfirmed(args);

            expect(result).toBe(true);
            expect(mockRequestConfirmation).toHaveBeenCalledTimes(1);
            expect(mockRequestConfirmation).toHaveBeenCalledWith(
                "You are about to execute the `test-tool` tool which requires additional confirmation. Would you like to proceed?"
            );
        });

        it("should return false when user declines confirmation", async () => {
            mockConfig.confirmationRequiredTools = ["test-tool"];
            mockRequestConfirmation.mockResolvedValue(false);

            const args = { param1: "test" };
            const result = await testTool.verifyConfirmed(args);

            expect(result).toBe(false);
            expect(mockRequestConfirmation).toHaveBeenCalledTimes(1);
        });
    });

    describe("isFeatureEnabled", () => {
        it("should return false for any feature by default", () => {
            expect(testTool["isFeatureEnabled"]("search")).to.equal(false);
            expect(testTool["isFeatureEnabled"]("someOtherFeature" as PreviewFeature)).to.equal(false);
        });

        it("should return true for enabled features", () => {
            mockConfig.previewFeatures = ["search", "someOtherFeature" as PreviewFeature];
            expect(testTool["isFeatureEnabled"]("search")).to.equal(true);
            expect(testTool["isFeatureEnabled"]("someOtherFeature" as PreviewFeature)).to.equal(true);

            expect(testTool["isFeatureEnabled"]("anotherFeature" as PreviewFeature)).to.equal(false);
        });
    });

    describe("resolveTelemetryMetadata", () => {
        let mockCallback: ToolCallback<(typeof testTool)["argsShape"]>;
        beforeEach(() => {
            const mockServer = {
                mcpServer: {
                    registerTool: (
                        name: string,
                        {
                            description,
                        }: { description: string; inputSchema: ZodRawShape; annotations: ToolAnnotations },
                        cb: ToolCallback<ZodRawShape>
                    ): void => {
                        expect(name).toBe(testTool.name);
                        expect(description).toBe(testTool["description"]);
                        mockCallback = cb;
                    },
                },
            };
            testTool.register(mockServer as unknown as Server);
        });

        it("should return empty metadata by default", async () => {
            await mockCallback(
                {
                    param1: "value1",
                    param2: 3,
                },
                {} as never
            );
            const event = ((mockTelemetry.emitEvents as Mock).mock.lastCall?.[0] as ToolEvent[])[0];
            expectDefined(event);
            expect(event.properties.result).to.equal("success");
            expect(event.properties).toHaveProperty("test_param2");
            expect(event.properties).not.toHaveProperty("project_id");
            expect(event.properties).not.toHaveProperty("org_id");
            expect(event.properties).not.toHaveProperty("atlas_local_deployment_id");
        });

        it("should include custom telemetry metadata", async () => {
            await mockCallback({ param1: "value1", param2: 3 }, {} as never);
            const event = ((mockTelemetry.emitEvents as Mock).mock.lastCall?.[0] as ToolEvent[])[0];
            expectDefined(event);

            expect(event.properties.result).to.equal("success");
            expect(event.properties).toHaveProperty("test_param2", "three");
        });
    });

    describe("getConnectionInfoMetadata", () => {
        it("should return empty metadata when neither connectedAtlasCluster nor connectionStringInfo are set", () => {
            (mockSession as { connectedAtlasCluster?: unknown }).connectedAtlasCluster = undefined;
            (mockSession as { connectionStringInfo?: unknown }).connectionStringInfo = undefined;

            const metadata = testTool["getConnectionInfoMetadata"]();

            expect(metadata).toEqual({});
            expect(metadata).not.toHaveProperty("project_id");
            expect(metadata).not.toHaveProperty("connection_auth_type");
            expect(metadata).not.toHaveProperty("connection_host_type");
        });

        it("should return metadata with project_id when connectedAtlasCluster.projectId is set", () => {
            (mockSession as { connectedAtlasCluster?: unknown }).connectedAtlasCluster = {
                projectId: "test-project-id",
                username: "test-user",
                clusterName: "test-cluster",
                expiryDate: new Date(),
            };
            (mockSession as { connectionStringInfo?: unknown }).connectionStringInfo = undefined;

            const metadata = testTool["getConnectionInfoMetadata"]();

            expect(metadata).toEqual({
                project_id: "test-project-id",
            });
            expect(metadata).not.toHaveProperty("connection_auth_type");
            expect(metadata).not.toHaveProperty("connection_host_type");
        });

        it("should return empty metadata when connectedAtlasCluster exists but projectId is falsy", () => {
            (mockSession as { connectedAtlasCluster?: unknown }).connectedAtlasCluster = {
                projectId: "",
                username: "test-user",
                clusterName: "test-cluster",
                expiryDate: new Date(),
            };
            (mockSession as { connectionStringInfo?: unknown }).connectionStringInfo = undefined;

            const metadata = testTool["getConnectionInfoMetadata"]();

            expect(metadata).toEqual({});
            expect(metadata).not.toHaveProperty("project_id");
        });

        it("should return metadata with connection_auth_type and connection_host_type when connectionStringInfo is set", () => {
            (mockSession as { connectedAtlasCluster?: unknown }).connectedAtlasCluster = undefined;
            (mockSession as { connectionStringInfo?: unknown }).connectionStringInfo = {
                authType: "scram",
                hostType: "unknown",
            };

            const metadata = testTool["getConnectionInfoMetadata"]();

            expect(metadata).toEqual({
                connection_auth_type: "scram",
                connection_host_type: "unknown",
            });
            expect(metadata).not.toHaveProperty("project_id");
        });

        it("should return metadata with both project_id and connection_auth_type when both are set", () => {
            (mockSession as { connectedAtlasCluster?: unknown }).connectedAtlasCluster = {
                projectId: "test-project-id",
                username: "test-user",
                clusterName: "test-cluster",
                expiryDate: new Date(),
            };
            (mockSession as { connectionStringInfo?: unknown }).connectionStringInfo = {
                authType: "oidc-auth-flow",
                hostType: "atlas",
            };

            const metadata = testTool["getConnectionInfoMetadata"]();

            expect(metadata).toEqual({
                project_id: "test-project-id",
                connection_auth_type: "oidc-auth-flow",
                connection_host_type: "atlas",
            });
        });

        it("should handle different connectionStringInfo authType and hostType values", () => {
            const authTypes = ["scram", "ldap", "kerberos", "oidc-auth-flow", "oidc-device-flow", "x.509"] as const;
            const hostTypes = ["unknown", "atlas", "local", "atlas_local"] as const;

            for (const authType of authTypes) {
                for (const hostType of hostTypes) {
                    (mockSession as { connectionStringInfo?: unknown }).connectionStringInfo = {
                        authType,
                        hostType,
                    };
                    const metadata = testTool["getConnectionInfoMetadata"]();
                    expect(metadata.connection_auth_type).toBe(authType);
                    expect(metadata.connection_host_type).toBe(hostType);
                }
            }
        });
    });

    describe("toolMeta", () => {
        it("should return correct metadata for stdio transport", () => {
            mockConfig.transport = "stdio";

            const meta = testTool["toolMeta"];

            expect(meta["com.mongodb/transport"]).toBe("stdio");
            expect(meta["com.mongodb/maxRequestPayloadBytes"]).toBe(TRANSPORT_PAYLOAD_LIMITS.stdio);
        });

        it("should return correct metadata for http transport", () => {
            mockConfig.transport = "http";

            const meta = testTool["toolMeta"];

            expect(meta["com.mongodb/transport"]).toBe("http");
            expect(meta["com.mongodb/maxRequestPayloadBytes"]).toBe(TRANSPORT_PAYLOAD_LIMITS.http);
        });

        it("should fallback to stdio limits for unknown transport", () => {
            // This tests the fallback behavior when an unknown transport is provided
            mockConfig.transport = "unknown-transport" as "stdio" | "http";

            const meta = testTool["toolMeta"];

            expect(meta["com.mongodb/transport"]).toBe("unknown-transport");
            expect(meta["com.mongodb/maxRequestPayloadBytes"]).toBe(TRANSPORT_PAYLOAD_LIMITS.stdio);
        });
    });

    describe("appendUIResource", () => {
        let mockUIRegistry: UIRegistry;
        let mockUIRegistryGet: ReturnType<typeof vi.fn>;
        let toolWithUI: TestToolWithOutputSchema;
        let mockCallback: ToolCallback<(typeof toolWithUI)["argsShape"]>;

        beforeEach(() => {
            mockUIRegistryGet = vi.fn();
            mockUIRegistry = {
                get: mockUIRegistryGet,
            } as unknown as UIRegistry;
        });

        function createToolWithUI(previewFeatures: PreviewFeature[] = []): TestToolWithOutputSchema {
            mockConfig.previewFeatures = previewFeatures;
            const constructorParams: ToolConstructorParams = {
                category: TestToolWithOutputSchema.category,
                operationType: TestToolWithOutputSchema.operationType,
                session: mockSession,
                config: mockConfig,
                telemetry: mockTelemetry,
                elicitation: mockElicitation,
                uiRegistry: mockUIRegistry,
            };
            return new TestToolWithOutputSchema(constructorParams);
        }

        function registerTool(tool: TestToolWithOutputSchema): void {
            const mockServer = {
                mcpServer: {
                    registerTool: (
                        _name: string,
                        _config: {
                            description: string;
                            inputSchema: ZodRawShape;
                            outputSchema?: ZodRawShape;
                            annotations: ToolAnnotations;
                        },
                        cb: ToolCallback<ZodRawShape>
                    ): { enabled: boolean; disable: () => void; enable: () => void } => {
                        mockCallback = cb;
                        return { enabled: true, disable: vi.fn(), enable: vi.fn() };
                    },
                },
            };
            tool.register(mockServer as unknown as Server);
        }

        it("should not append UIResource when mcpUI feature is disabled", async () => {
            toolWithUI = createToolWithUI([]);
            (mockUIRegistry.get as Mock).mockReturnValue("<html>test UI</html>");
            registerTool(toolWithUI);

            const result = await mockCallback({ input: "test" }, {} as never);

            expect(result.content).toHaveLength(1);
            expect(result.content[0]).toEqual({ type: "text", text: "Tool with output schema executed" });
            expect(result.content.some((c: { type: string }) => c.type === "resource")).toBe(false);
        });

        it("should not append UIResource when no UI is registered for the tool", async () => {
            toolWithUI = createToolWithUI(["mcpUI"]);
            (mockUIRegistry.get as Mock).mockReturnValue(undefined);
            registerTool(toolWithUI);

            const result = await mockCallback({ input: "test" }, {} as never);

            expect(result.content).toHaveLength(1);
            expect(mockUIRegistryGet).toHaveBeenCalledWith("test-tool-with-output-schema");
        });

        it("should not append UIResource when structuredContent is missing", async () => {
            const toolWithoutStructured = createToolWithoutStructuredContent(
                ["mcpUI"],
                mockSession,
                mockConfig,
                mockTelemetry,
                mockElicitation,
                mockUIRegistry
            );
            (mockUIRegistry.get as Mock).mockReturnValue("<html>test UI</html>");

            let noStructuredCallback: ToolCallback<ZodRawShape> | undefined;
            const mockServer = {
                mcpServer: {
                    registerTool: (
                        _name: string,
                        _config: unknown,
                        cb: ToolCallback<ZodRawShape>
                    ): { enabled: boolean; disable: () => void; enable: () => void } => {
                        noStructuredCallback = cb;
                        return { enabled: true, disable: vi.fn(), enable: vi.fn() };
                    },
                },
            };
            toolWithoutStructured.register(mockServer as unknown as Server);

            expectDefined(noStructuredCallback);
            const result = await noStructuredCallback({ input: "test" }, {} as never);

            expect(result.content).toHaveLength(1);
            expect(result.structuredContent).toBeUndefined();
        });

        it("should append UIResource correctly when all conditions are met", async () => {
            toolWithUI = createToolWithUI(["mcpUI"]);
            (mockUIRegistry.get as Mock).mockReturnValue("<html>test UI</html>");
            registerTool(toolWithUI);

            const result = await mockCallback({ input: "test" }, {} as never);

            expect(result.content).toHaveLength(2);
            expect(result.content[0]).toEqual({ type: "text", text: "Tool with output schema executed" });

            const uiResource = result.content[1] as {
                type: string;
                resource: { uri: string; text: string; mimeType: string; _meta?: Record<string, unknown> };
            };
            expect(uiResource.type).toBe("resource");
            expect(uiResource.resource.uri).toBe("ui://test-tool-with-output-schema");
            expect(uiResource.resource.text).toBe("<html>test UI</html>");
            expect(uiResource.resource.mimeType).toBe("text/html");
            expect(uiResource.resource._meta).toEqual({
                "mcpui.dev/ui-initial-render-data": { value: "test", count: 42 },
            });
        });

        it("should use structuredContent as initial-render-data in UIResource metadata", async () => {
            toolWithUI = createToolWithUI(["mcpUI"]);
            (mockUIRegistry.get as Mock).mockReturnValue("<html>custom UI</html>");
            registerTool(toolWithUI);

            const result = await mockCallback({ input: "custom-input" }, {} as never);

            const uiResource = result.content[1] as { resource: { _meta?: Record<string, unknown> } };
            expect(uiResource.resource._meta?.["mcpui.dev/ui-initial-render-data"]).toEqual({
                value: "custom-input",
                count: 42,
            });
        });

        it("should preserve original result properties when appending UIResource", async () => {
            toolWithUI = createToolWithUI(["mcpUI"]);
            (mockUIRegistry.get as Mock).mockReturnValue("<html>test UI</html>");
            registerTool(toolWithUI);

            const result = await mockCallback({ input: "test" }, {} as never);

            expect(result.structuredContent).toEqual({ value: "test", count: 42 });
            expect(result.isError).toBeUndefined();
        });
    });
});

function createToolWithoutStructuredContent(
    previewFeatures: PreviewFeature[],
    mockSession: Session,
    mockConfig: UserConfig,
    mockTelemetry: Telemetry,
    mockElicitation: Elicitation,
    mockUIRegistry: UIRegistry
): TestToolWithoutStructuredContent {
    mockConfig.previewFeatures = previewFeatures;
    const constructorParams: ToolConstructorParams = {
        category: TestToolWithoutStructuredContent.category,
        operationType: TestToolWithoutStructuredContent.operationType,
        session: mockSession,
        config: mockConfig,
        telemetry: mockTelemetry,
        elicitation: mockElicitation,
        uiRegistry: mockUIRegistry,
    };
    return new TestToolWithoutStructuredContent(constructorParams);
}

class TestTool extends ToolBase {
    public name = "test-tool";
    static category: ToolCategory = "mongodb";
    static operationType: OperationType = "delete";
    public description = "A test tool for verification tests";
    public argsShape = {
        param1: z.string().describe("Test parameter 1"),
        param2: z.number().optional().describe("Test parameter 2"),
    };

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

    protected resolveTelemetryMetadata(
        args: ToolArgs<typeof this.argsShape>,
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        { result }: { result: CallToolResult }
    ): TelemetryToolMetadata {
        if (args.param2 === 3) {
            return {
                test_param2: "three",
            } as TelemetryToolMetadata;
        }

        return {};
    }
}

class TestToolWithOutputSchema extends ToolBase {
    public name = "test-tool-with-output-schema";
    static category: ToolCategory = "mongodb";
    static operationType: OperationType = "metadata";
    public description = "A test tool with output schema";
    public argsShape = {
        input: z.string().describe("Test input"),
    };
    public override outputSchema = {
        value: z.string(),
        count: z.number(),
    };

    protected async execute(args: ToolArgs<typeof this.argsShape>): Promise<CallToolResult> {
        return Promise.resolve({
            content: [
                {
                    type: "text",
                    text: "Tool with output schema executed",
                },
            ],
            structuredContent: {
                value: args.input,
                count: 42,
            },
        });
    }

    protected resolveTelemetryMetadata(): TelemetryToolMetadata {
        return {};
    }
}

class TestToolWithoutStructuredContent extends ToolBase {
    public name = "test-tool-without-structured";
    static category: ToolCategory = "mongodb";
    static operationType: OperationType = "metadata";
    public description = "A test tool without structured content";
    public argsShape = {
        input: z.string().describe("Test input"),
    };
    public override outputSchema = {
        value: z.string(),
    };

    protected async execute(): Promise<CallToolResult> {
        return Promise.resolve({
            content: [
                {
                    type: "text",
                    text: "Tool without structured content executed",
                },
            ],
        });
    }

    protected resolveTelemetryMetadata(): TelemetryToolMetadata {
        return {};
    }
}
