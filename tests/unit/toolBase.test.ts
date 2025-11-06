import type { Mock } from "vitest";
import { describe, it, expect, vi, beforeEach, type MockedFunction } from "vitest";
import type { ZodRawShape } from "zod";
import { z } from "zod";
import type {
    ToolCallbackArgs,
    OperationType,
    ToolCategory,
    ToolConstructorParams,
    ToolArgs,
} from "../../src/tools/tool.js";
import { ToolBase } from "../../src/tools/tool.js";
import type { CallToolResult, ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import type { Session } from "../../src/common/session.js";
import type { UserConfig } from "../../src/common/config.js";
import type { Telemetry } from "../../src/telemetry/telemetry.js";
import type { Elicitation } from "../../src/elicitation.js";
import type { CompositeLogger } from "../../src/common/logger.js";
import type { ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Server } from "../../src/server.js";
import type { TelemetryToolMetadata, ToolEvent } from "../../src/telemetry/types.js";
import { expectDefined } from "../integration/helpers.js";
import type { PreviewFeature } from "../../src/common/schemas.js";

describe("ToolBase", () => {
    let mockSession: Session;
    let mockLogger: CompositeLogger;
    let mockConfig: UserConfig;
    let mockTelemetry: Telemetry;
    let mockElicitation: Elicitation;
    let mockRequestConfirmation: MockedFunction<(message: string) => Promise<boolean>>;
    let testTool: TestTool;

    beforeEach(() => {
        mockLogger = {
            info: vi.fn(),
            debug: vi.fn(),
            warning: vi.fn(),
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
            session: mockSession,
            config: mockConfig,
            telemetry: mockTelemetry,
            elicitation: mockElicitation,
        };

        testTool = new TestTool(constructorParams);
    });

    describe("verifyConfirmed", () => {
        it("should return true when tool is not in confirmationRequiredTools list", async () => {
            mockConfig.confirmationRequiredTools = ["other-tool", "another-tool"];

            const args = [
                { param1: "test" },
                {} as ToolCallbackArgs<(typeof testTool)["argsShape"]>[1],
            ] as ToolCallbackArgs<(typeof testTool)["argsShape"]>;
            const result = await testTool.verifyConfirmed(args);

            expect(result).toBe(true);
            expect(mockRequestConfirmation).not.toHaveBeenCalled();
        });

        it("should return true when confirmationRequiredTools list is empty", async () => {
            mockConfig.confirmationRequiredTools = [];

            const args = [{ param1: "test" }, {} as ToolCallbackArgs<(typeof testTool)["argsShape"]>[1]];
            const result = await testTool.verifyConfirmed(args as ToolCallbackArgs<(typeof testTool)["argsShape"]>);

            expect(result).toBe(true);
            expect(mockRequestConfirmation).not.toHaveBeenCalled();
        });

        it("should call requestConfirmation when tool is in confirmationRequiredTools list", async () => {
            mockConfig.confirmationRequiredTools = ["test-tool"];
            mockRequestConfirmation.mockResolvedValue(true);

            const args = [{ param1: "test", param2: 42 }, {} as ToolCallbackArgs<(typeof testTool)["argsShape"]>[1]];
            const result = await testTool.verifyConfirmed(args as ToolCallbackArgs<(typeof testTool)["argsShape"]>);

            expect(result).toBe(true);
            expect(mockRequestConfirmation).toHaveBeenCalledTimes(1);
            expect(mockRequestConfirmation).toHaveBeenCalledWith(
                "You are about to execute the `test-tool` tool which requires additional confirmation. Would you like to proceed?"
            );
        });

        it("should return false when user declines confirmation", async () => {
            mockConfig.confirmationRequiredTools = ["test-tool"];
            mockRequestConfirmation.mockResolvedValue(false);

            const args = [{ param1: "test" }, {} as ToolCallbackArgs<(typeof testTool)["argsShape"]>[1]];
            const result = await testTool.verifyConfirmed(args as ToolCallbackArgs<(typeof testTool)["argsShape"]>);

            expect(result).toBe(false);
            expect(mockRequestConfirmation).toHaveBeenCalledTimes(1);
        });
    });

    describe("isFeatureEnabled", () => {
        it("should return false for any feature by default", () => {
            expect(testTool["isFeatureEnabled"]("vectorSearch")).to.equal(false);
            expect(testTool["isFeatureEnabled"]("someOtherFeature" as PreviewFeature)).to.equal(false);
        });

        it("should return true for enabled features", () => {
            mockConfig.previewFeatures = ["vectorSearch", "someOtherFeature" as PreviewFeature];
            expect(testTool["isFeatureEnabled"]("vectorSearch")).to.equal(true);
            expect(testTool["isFeatureEnabled"]("someOtherFeature" as PreviewFeature)).to.equal(true);

            expect(testTool["isFeatureEnabled"]("anotherFeature" as PreviewFeature)).to.equal(false);
        });
    });

    describe("resolveTelemetryMetadata", () => {
        let mockCallback: ToolCallback<(typeof testTool)["argsShape"]>;
        beforeEach(() => {
            const mockServer = {
                mcpServer: {
                    tool: (
                        name: string,
                        description: string,
                        paramsSchema: unknown,
                        annotations: ToolAnnotations,
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
            await mockCallback({ param1: "value1" }, {} as never);
            const event = ((mockTelemetry.emitEvents as Mock).mock.lastCall?.[0] as ToolEvent[])[0];
            expectDefined(event);
            expect(event.properties.result).to.equal("success");
            expect(event.properties).not.toHaveProperty("project_id");
            expect(event.properties).not.toHaveProperty("org_id");
            expect(event.properties).not.toHaveProperty("atlas_local_deployment_id");
            expect(event.properties).not.toHaveProperty("test_param2");
        });

        it("should include custom telemetry metadata", async () => {
            await mockCallback({ param1: "value1", param2: 3 }, {} as never);
            const event = ((mockTelemetry.emitEvents as Mock).mock.lastCall?.[0] as ToolEvent[])[0];
            expectDefined(event);

            expect(event.properties.result).to.equal("success");
            expect(event.properties).toHaveProperty("test_param2", "three");
        });
    });
});

class TestTool extends ToolBase {
    public name = "test-tool";
    public category: ToolCategory = "mongodb";
    public operationType: OperationType = "delete";
    protected description = "A test tool for verification tests";
    protected argsShape = {
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
        result: CallToolResult,
        args: ToolArgs<typeof this.argsShape>
    ): TelemetryToolMetadata {
        if (args.param2 === 3) {
            return {
                test_param2: "three",
            } as TelemetryToolMetadata;
        }

        return {};
    }
}
