import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { OperationType, ToolArgs, ToolConstructorParams } from "../../../../../src/tools/tool.js";
import { StreamsToolBase } from "../../../../../src/tools/atlas/streams/streamsToolBase.js";
import { ApiClientError } from "../../../../../src/common/atlas/apiClientError.js";
import type { Session } from "../../../../../src/common/session.js";
import type { UserConfig } from "../../../../../src/common/config/userConfig.js";
import type { Telemetry } from "../../../../../src/telemetry/telemetry.js";
import type { Elicitation } from "../../../../../src/elicitation.js";
import type { CompositeLogger } from "../../../../../src/common/logger.js";
import type { TelemetryToolMetadata } from "../../../../../src/telemetry/types.js";
import { UIRegistry } from "../../../../../src/ui/registry/index.js";

class TestStreamsTool extends StreamsToolBase {
    static toolName = "test-streams-tool";
    static operationType: OperationType = "read";

    public description = "A test streams tool";
    public argsShape = {
        projectId: z.string().describe("project id"),
        workspaceName: z.string().optional().describe("workspace name"),
        resourceName: z.string().optional().describe("resource name"),
        action: z.string().optional().describe("action"),
    };

    protected execute(): Promise<CallToolResult> {
        return Promise.resolve({ content: [{ type: "text", text: "ok" }] });
    }

    // Expose protected methods for testing
    public testHandleError(
        error: unknown,
        args: ToolArgs<typeof this.argsShape>
    ): Promise<CallToolResult> | CallToolResult {
        return this.handleError(error, args);
    }

    public testVerifyAllowed(): boolean {
        return this.verifyAllowed();
    }

    public testResolveTelemetryMetadata(
        args: ToolArgs<typeof this.argsShape>,
        result: CallToolResult
    ): TelemetryToolMetadata {
        return this.resolveTelemetryMetadata(args, { result });
    }
}

function createApiClientError(status: number, message: string): ApiClientError {
    const response = new Response(null, { status, statusText: "Error" });
    return ApiClientError.fromError(response, { reason: message, error: status, errorCode: `${status}` });
}

describe("StreamsToolBase", () => {
    let mockSession: Session;
    let mockConfig: UserConfig;
    let mockTelemetry: Telemetry;
    let mockElicitation: Elicitation;
    let tool: TestStreamsTool;

    beforeEach(() => {
        const mockLogger = {
            info: vi.fn(),
            debug: vi.fn(),
            warning: vi.fn(),
            error: vi.fn(),
        } as unknown as CompositeLogger;

        mockSession = {
            logger: mockLogger,
            apiClient: {},
        } as unknown as Session;

        mockConfig = {
            confirmationRequiredTools: [],
            previewFeatures: ["streams"],
            disabledTools: [],
            apiClientId: "test-id",
            apiClientSecret: "test-secret",
        } as unknown as UserConfig;

        mockTelemetry = {
            isTelemetryEnabled: () => true,
            emitEvents: vi.fn(),
        } as unknown as Telemetry;

        mockElicitation = {
            requestConfirmation: vi.fn(),
        } as unknown as Elicitation;

        const params: ToolConstructorParams = {
            name: TestStreamsTool.toolName,
            category: "atlas",
            operationType: TestStreamsTool.operationType,
            session: mockSession,
            config: mockConfig,
            telemetry: mockTelemetry,
            elicitation: mockElicitation,
            uiRegistry: new UIRegistry(),
        };

        tool = new TestStreamsTool(params);
    });

    // Cast partial args since ToolArgs requires all keys even for optional Zod fields
    const defaultArgs = { projectId: "proj1" } as never;

    describe("handleError", () => {
        it("should handle 404 with discover hint", () => {
            const error = createApiClientError(404, "Not found");
            const result = tool.testHandleError(error, defaultArgs) as CallToolResult;
            expect(result.isError).toBe(true);
            expect(result.content[0]).toHaveProperty("text");
            expect((result.content[0] as { text: string }).text).toContain("Resource not found");
            expect((result.content[0] as { text: string }).text).toContain("atlas-streams-discover");
        });

        it("should handle 402 with billing hint and sp.process() suggestion", () => {
            const error = createApiClientError(402, "Payment required");
            const result = tool.testHandleError(error, defaultArgs) as CallToolResult;
            expect(result.isError).toBe(true);
            expect((result.content[0] as { text: string }).text).toContain("Payment Required");
            expect((result.content[0] as { text: string }).text).toContain("sp.process()");
        });

        it("should handle 403 with active processor in message", () => {
            const error = createApiClientError(403, "Cannot delete workspace with active processor");
            const result = tool.testHandleError(error, defaultArgs) as CallToolResult;
            expect(result.isError).toBe(true);
            expect((result.content[0] as { text: string }).text).toContain("Stop all processors first");
        });

        it("should handle 403 without active processor", () => {
            const error = createApiClientError(403, "Forbidden");
            const result = tool.testHandleError(error, defaultArgs) as CallToolResult;
            expect(result.isError).toBe(true);
            expect((result.content[0] as { text: string }).text).toContain("sufficient permissions");
        });

        it("should handle 400 with topic + AtlasCollection ($emit not $merge hint)", () => {
            const error = createApiClientError(400, "IDLUnknownField: 'topic' in AtlasCollection");
            const result = tool.testHandleError(error, defaultArgs) as CallToolResult;
            expect(result.isError).toBe(true);
            expect((result.content[0] as { text: string }).text).toContain("$emit");
            expect((result.content[0] as { text: string }).text).toContain("not $merge");
        });

        it("should handle 400 with schemaRegistryName hint", () => {
            const error = createApiClientError(400, "IDLUnknownField: schemaRegistryName");
            const result = tool.testHandleError(error, defaultArgs) as CallToolResult;
            expect(result.isError).toBe(true);
            expect((result.content[0] as { text: string }).text).toContain("schemaRegistry:");
        });

        it("should handle 400 with valueSchema missing hint", () => {
            const error = createApiClientError(400, "IDLFailedToParse: valueSchema is missing");
            const result = tool.testHandleError(error, defaultArgs) as CallToolResult;
            expect(result.isError).toBe(true);
            expect((result.content[0] as { text: string }).text).toContain("valueSchema is required");
        });

        it("should handle 400 with Enumeration type (case-sensitive hint)", () => {
            const error = createApiClientError(400, "BadValue: Enumeration value 'AVRO' for type not valid");
            const result = tool.testHandleError(error, defaultArgs) as CallToolResult;
            expect(result.isError).toBe(true);
            expect((result.content[0] as { text: string }).text).toContain("case-sensitive");
        });

        it("should handle 400 with MergeOperatorSpec hint", () => {
            const error = createApiClientError(400, "IDLUnknownField in MergeOperatorSpec");
            const result = tool.testHandleError(error, defaultArgs) as CallToolResult;
            expect(result.isError).toBe(true);
            expect((result.content[0] as { text: string }).text).toContain("$merge writes to Atlas clusters");
            expect((result.content[0] as { text: string }).text).toContain("$emit instead");
        });

        it("should handle 400 generic with default hint", () => {
            const error = createApiClientError(400, "Some other bad request");
            const result = tool.testHandleError(error, defaultArgs) as CallToolResult;
            expect(result.isError).toBe(true);
            expect((result.content[0] as { text: string }).text).toContain("Bad Request");
            expect((result.content[0] as { text: string }).text).toContain("invalid configuration");
        });

        it("should handle 409 conflict", () => {
            const error = createApiClientError(409, "Resource already exists");
            const result = tool.testHandleError(error, defaultArgs) as CallToolResult;
            expect(result.isError).toBe(true);
            expect((result.content[0] as { text: string }).text).toContain("Conflict");
            expect((result.content[0] as { text: string }).text).toContain("atlas-streams-discover");
        });

        it("should handle resumeFromCheckpoint error", () => {
            const error = new Error("Failed due to resumeFromCheckpoint conflict");
            const result = tool.testHandleError(error, defaultArgs) as CallToolResult;
            expect(result.isError).toBe(true);
            expect((result.content[0] as { text: string }).text).toContain("Checkpoint conflict");
            expect((result.content[0] as { text: string }).text).toContain("resumeFromCheckpoint=false");
        });

        it("should handle SASL authentication error", () => {
            const error = new Error("SASL authentication failed");
            const result = tool.testHandleError(error, defaultArgs) as CallToolResult;
            expect(result.isError).toBe(true);
            expect((result.content[0] as { text: string }).text).toContain("Authentication failure");
            expect((result.content[0] as { text: string }).text).toContain("Kafka connection credentials");
        });

        it("should handle authentication failed error", () => {
            const error = new Error("Broker returned authentication failed");
            const result = tool.testHandleError(error, defaultArgs) as CallToolResult;
            expect(result.isError).toBe(true);
            expect((result.content[0] as { text: string }).text).toContain("Authentication failure");
        });

        it("should handle INVALID_STATE error", () => {
            const error = new Error("INVALID_STATE: cannot transition from STARTED to STARTED");
            const result = tool.testHandleError(error, defaultArgs) as CallToolResult;
            expect(result.isError).toBe(true);
            expect((result.content[0] as { text: string }).text).toContain("Invalid state transition");
        });

        it("should delegate other errors to super.handleError()", () => {
            const error = new Error("Something totally unexpected");
            const result = tool.testHandleError(error, defaultArgs) as CallToolResult;
            expect(result.isError).toBe(true);
            expect((result.content[0] as { text: string }).text).toContain("Something totally unexpected");
            // Should NOT contain any streams-specific hints
            expect((result.content[0] as { text: string }).text).not.toContain("atlas-streams-discover");
            expect((result.content[0] as { text: string }).text).not.toContain("Checkpoint conflict");
        });
    });

    describe("verifyAllowed", () => {
        it("should return false when streams feature is not enabled", () => {
            mockConfig.previewFeatures = [];
            expect(tool.testVerifyAllowed()).toBe(false);
        });

        it("should return true when streams feature is enabled and API credentials are set", () => {
            mockConfig.previewFeatures = ["streams"];
            expect(tool.testVerifyAllowed()).toBe(true);
        });

        it("should return false when streams is enabled but no API credentials", () => {
            mockConfig.previewFeatures = ["streams"];
            mockConfig.apiClientId = "";
            mockConfig.apiClientSecret = "";
            expect(tool.testVerifyAllowed()).toBe(false);
        });
    });

    describe("resolveTelemetryMetadata", () => {
        const okResult: CallToolResult = { content: [{ type: "text", text: "ok" }] };

        it("should include workspace_name when workspaceName arg is present", () => {
            const metadata = tool.testResolveTelemetryMetadata(
                { projectId: "proj1", workspaceName: "ws1" } as never,
                okResult
            );
            expect(metadata).toHaveProperty("workspace_name", "ws1");
        });

        it("should include connection_name when resourceName + connection action", () => {
            const metadata = tool.testResolveTelemetryMetadata(
                { projectId: "proj1", resourceName: "my-conn", action: "delete-connection" } as never,
                okResult
            );
            expect(metadata).toHaveProperty("connection_name", "my-conn");
            expect(metadata).not.toHaveProperty("processor_name");
        });

        it("should include processor_name when resourceName + non-connection action", () => {
            const metadata = tool.testResolveTelemetryMetadata(
                { projectId: "proj1", resourceName: "my-proc", action: "start-processor" } as never,
                okResult
            );
            expect(metadata).toHaveProperty("processor_name", "my-proc");
            expect(metadata).not.toHaveProperty("connection_name");
        });

        it("should include action in metadata", () => {
            const metadata = tool.testResolveTelemetryMetadata(
                { projectId: "proj1", action: "list-workspaces" } as never,
                okResult
            );
            expect(metadata).toHaveProperty("action", "list-workspaces");
        });

        it("should return base metadata on invalid args", () => {
            // projectId is required, passing empty object should fail Zod parse
            const metadata = tool.testResolveTelemetryMetadata({} as never, okResult);
            expect(metadata).not.toHaveProperty("workspace_name");
            expect(metadata).not.toHaveProperty("action");
        });
    });
});
