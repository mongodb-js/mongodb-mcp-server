import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { OperationType, ToolArgs, ToolConstructorParams } from "../../../../../src/tools/tool.js";
import { StreamsToolBase } from "../../../../../src/tools/atlas/streams/streamsToolBase.js";
import { ApiClientError } from "@mongodb-js/mcp-atlas-api-client";
import type { Session } from "../../../../../src/common/session.js";
import type { UserConfig } from "../../../../../src/common/config/userConfig.js";
import type { Telemetry } from "../../../../../src/telemetry/telemetry.js";
import type { Elicitation } from "../../../../../src/elicitation.js";
import type { CompositeLogger } from "@mongodb-js/mcp-core";
import type { TelemetryToolMetadata } from "../../../../../src/telemetry/types.js";
import { UIRegistry } from "../../../../../src/ui/registry/index.js";
import { MockMetrics } from "../../../mocks/metrics.js";
import { Keychain } from "@mongodb-js/mcp-core";

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

    // Expose protected static methods for testing
    public static testExtractConnectionNames(obj: unknown): Set<string> {
        return StreamsToolBase.extractConnectionNames(obj);
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
    return ApiClientError.fromError({ response, error: { reason: message, error: status, errorCode: `${status}` } });
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
            keychain: new Keychain(),
        } as unknown as Session;

        mockConfig = {
            confirmationRequiredTools: [],
            previewFeatures: [],
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
            metrics: new MockMetrics(),
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

        it("should handle 403 with active processor in message", () => {
            const error = createApiClientError(403, "Cannot delete workspace with active processor");
            const result = tool.testHandleError(error, defaultArgs) as CallToolResult;
            expect(result.isError).toBe(true);
            expect((result.content[0] as { text: string }).text).toContain("Stop all processors first");
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

    describe("resolveTelemetryMetadata", () => {
        const okResult: CallToolResult = { content: [{ type: "text", text: "ok" }] };

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
            expect(metadata).not.toHaveProperty("action");
        });
    });

    describe("extractConnectionNames", () => {
        const extract = (obj: unknown): Set<string> => TestStreamsTool.testExtractConnectionNames(obj);

        it("should extract connectionName from flat objects", () => {
            const result = extract({ connectionName: "src" });
            expect(result).toEqual(new Set(["src"]));
        });

        it("should extract connectionNames from pipeline arrays", () => {
            const pipeline = [
                { $source: { connectionName: "src" } },
                { $merge: { into: { connectionName: "sink", db: "db1", coll: "c1" } } },
            ];
            const result = extract(pipeline);
            expect(result).toEqual(new Set(["src", "sink"]));
        });

        it("should extract deeply nested connectionNames (e.g. schemaRegistry)", () => {
            const pipeline = [
                { $source: { connectionName: "kafka-in" } },
                {
                    $emit: {
                        connectionName: "kafka-out",
                        schemaRegistry: { connectionName: "sr-conn" },
                    },
                },
            ];
            const result = extract(pipeline);
            expect(result).toEqual(new Set(["kafka-in", "kafka-out", "sr-conn"]));
        });

        it("should return empty set for primitives and null", () => {
            expect(extract(null)).toEqual(new Set());
            expect(extract("string")).toEqual(new Set());
            expect(extract(42)).toEqual(new Set());
            expect(extract(undefined)).toEqual(new Set());
        });

        it("should return empty set for empty pipeline", () => {
            expect(extract([])).toEqual(new Set());
        });
    });
});
