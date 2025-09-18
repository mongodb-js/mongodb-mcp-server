import { describe, it, expect, vi, beforeEach, type MockedFunction } from "vitest";
import { z } from "zod";
import { ToolBase, type OperationType, type ToolCategory, type ToolConstructorParams } from "../../src/tools/tool.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { Session } from "../../src/common/session.js";
import type { UserConfig } from "../../src/common/config.js";
import type { Telemetry } from "../../src/telemetry/telemetry.js";
import type { Elicitation } from "../../src/elicitation.js";
import type { CompositeLogger } from "../../src/common/logger.js";
import type { TelemetryToolMetadata, ToolCallbackArgs } from "../../src/tools/tool.js";

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
        } as unknown as UserConfig;

        mockTelemetry = {} as Telemetry;

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

    protected resolveTelemetryMetadata(): TelemetryToolMetadata {
        return {};
    }
}
