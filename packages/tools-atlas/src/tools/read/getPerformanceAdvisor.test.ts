import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ToolConstructorParams } from "@mongodb-js/mcp-core";
import { GetPerformanceAdvisorTool } from "./getPerformanceAdvisor.js";
import type { ISession } from "@mongodb-js/mcp-types";
import type { ITelemetry } from "@mongodb-js/mcp-types";
import type { Elicitation } from "@mongodb-js/mcp-core";
import type { CompositeLogger } from "@mongodb-js/mcp-core";
import type { ApiClient } from "@mongodb-js/mcp-atlas-api-client";
import { ApiClientError } from "@mongodb-js/mcp-atlas-api-client";
import { UIRegistry } from "@mongodb-js/mcp-ui";
import { MockMetrics } from "@mongodb-js/mcp-test-utils";

const emptyDropSuggestions = {
    hiddenIndexes: [],
    redundantIndexes: [],
    unusedIndexes: [],
};

describe("GetPerformanceAdvisorTool", () => {
    let mockApiClient: Record<string, ReturnType<typeof vi.fn>>;
    let tool: GetPerformanceAdvisorTool;

    beforeEach(() => {
        mockApiClient = {
            listClusterSuggestedIndexes: vi.fn().mockResolvedValue({ content: { suggestedIndexes: [] } }),
            listDropIndexSuggestions: vi.fn().mockResolvedValue({ content: emptyDropSuggestions }),
            listSchemaAdvice: vi.fn().mockResolvedValue({ content: { recommendations: [] } }),
            getCluster: vi.fn().mockResolvedValue({ connectionStrings: { standard: "" } }),
            listSlowQueryLogs: vi.fn().mockResolvedValue({ slowQueries: [] }),
        };

        const mockLogger = {
            info: vi.fn(),
            debug: vi.fn(),
            warning: vi.fn(),
            error: vi.fn(),
        } as unknown as CompositeLogger;

        const mockSession = {
            logger: mockLogger,
            apiClient: { ...mockApiClient, logger: mockLogger } as unknown as ApiClient,
        } as unknown as ISession;

        const mockTelemetry = {
            isTelemetryEnabled: () => false,
            emitEvents: vi.fn(),
        } as unknown as ITelemetry;

        const mockElicitation = {
            requestConfirmation: vi.fn(),
        } as unknown as Elicitation;

        const params: ToolConstructorParams = {
            name: GetPerformanceAdvisorTool.toolName,
            category: "atlas",
            operationType: GetPerformanceAdvisorTool.operationType,
            session: mockSession,
            telemetry: mockTelemetry,
            elicitation: mockElicitation,
            metrics: new MockMetrics(),
            uiRegistry: new UIRegistry(),
        };

        tool = new GetPerformanceAdvisorTool(params);
    });

    const baseArgs = {
        projectId: "507f1f77bcf86cd799439011",
        clusterName: "my-cluster",
        operations: ["suggestedIndexes", "dropIndexSuggestions", "slowQueryLogs", "schemaSuggestions"] as const,
    };
    // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
    const exec = (args: Record<string, unknown>) =>
        tool["execute"](args as never, { signal: new AbortController().signal } as never);

    const text = (result: { content: unknown[] }): string =>
        result.content.map((c) => (c as { text: string }).text).join("\n");

    it("returns empty message when all requested operations have no data", async () => {
        const result = await exec({ ...baseArgs });

        expect(text(result)).toBe("No performance advisor recommendations found.");
        expect(result.structuredContent).toMatchObject({
            projectId: baseArgs.projectId,
            clusterName: baseArgs.clusterName,
            suggestedIndexes: [],
            dropIndexSuggestions: emptyDropSuggestions,
            slowQueryLogs: [],
            schemaSuggestions: [],
        });
    });

    it("returns sectioned content and structuredContent when data exists", async () => {
        mockApiClient.listClusterSuggestedIndexes!.mockResolvedValue({
            content: { suggestedIndexes: [{ namespace: "db.coll", weight: 42 }] },
        });

        const result = await exec({ ...baseArgs });

        expect(text(result)).toContain("Performance advisor data");
        expect(text(result)).toContain("## Suggested Indexes");
        expect(text(result)).toContain("db.coll");
        expect(result.structuredContent).toMatchObject({
            suggestedIndexes: [{ namespace: "db.coll", weight: 42 }],
        });
    });

    it("only calls API methods for requested operations", async () => {
        await exec({ ...baseArgs, operations: ["suggestedIndexes"] });

        expect(mockApiClient.listClusterSuggestedIndexes).toHaveBeenCalledOnce();
        expect(mockApiClient.listDropIndexSuggestions).not.toHaveBeenCalled();
        expect(mockApiClient.getCluster).not.toHaveBeenCalled();
        expect(mockApiClient.listSchemaAdvice).not.toHaveBeenCalled();
    });

    it("tolerates rejected operations via Promise.allSettled and still returns other data", async () => {
        mockApiClient.listClusterSuggestedIndexes!.mockRejectedValue(new Error("indexes failed"));
        mockApiClient.listSchemaAdvice!.mockResolvedValue({
            content: { recommendations: [{ namespace: "db.coll", sampleDocuments: [] }] },
        });

        const result = await exec({ ...baseArgs, operations: ["suggestedIndexes", "schemaSuggestions"] });

        expect(text(result)).toContain("## Schema Suggestions");
        expect(result.structuredContent).toMatchObject({
            suggestedIndexes: [],
            schemaSuggestions: [{ namespace: "db.coll", sampleDocuments: [] }],
        });
    });

    describe("handleError", () => {
        it("returns custom message for non-API errors", () => {
            const result = tool["handleError"](new Error("boom"), baseArgs as never) as {
                content: { text: string }[];
                isError?: boolean;
            };

            expect(result.isError).toBe(true);
            expect(result.content[0]?.text).toBe("Error retrieving performance advisor data: boom");
        });

        it("delegates ApiClientError to AtlasToolBase", () => {
            const apiError = ApiClientError.fromError({
                response: new Response(null, { status: 403, statusText: "Forbidden" }),
                error: "forbidden",
            });
            const result = tool["handleError"](apiError, baseArgs as never) as { content: { text: string }[] };

            expect(result.content[0]?.text).toContain("Forbidden API Error");
        });
    });
});
