import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ToolConstructorParams } from "../../../../../src/tools/tool.js";
import { ListAlertsTool } from "../../../../../src/tools/atlas/read/listAlerts.js";
import type { Session } from "../../../../../src/common/session.js";
import type { UserConfig } from "../../../../../src/common/config/userConfig.js";
import type { Telemetry } from "../../../../../src/telemetry/telemetry.js";
import type { Elicitation } from "../../../../../src/elicitation.js";
import type { CompositeLogger } from "@mongodb-js/mcp-core";
import type { ApiClient } from "@mongodb-js/mcp-atlas-api-client";
import { UIRegistry } from "../../../../../src/ui/registry/index.js";
import { MockMetrics } from "../../../mocks/metrics.js";

describe("ListAlertsTool", () => {
    let mockApiClient: Record<string, ReturnType<typeof vi.fn>>;
    let tool: ListAlertsTool;

    beforeEach(() => {
        mockApiClient = {
            listAlerts: vi.fn(),
        };

        const mockLogger = {
            info: vi.fn(),
            debug: vi.fn(),
            warning: vi.fn(),
            error: vi.fn(),
        } as unknown as CompositeLogger;

        const mockSession = {
            logger: mockLogger,
            apiClient: mockApiClient as unknown as ApiClient,
        } as unknown as Session;

        const mockConfig = {
            confirmationRequiredTools: [],
            previewFeatures: [],
            disabledTools: [],
            apiClientId: "test-id",
            apiClientSecret: "test-secret",
        } as unknown as UserConfig;

        const mockTelemetry = {
            isTelemetryEnabled: () => true,
            emitEvents: vi.fn(),
        } as unknown as Telemetry;

        const mockElicitation = {
            requestConfirmation: vi.fn(),
        } as unknown as Elicitation;

        const params: ToolConstructorParams = {
            name: ListAlertsTool.toolName,
            category: "atlas",
            operationType: ListAlertsTool.operationType,
            session: mockSession,
            config: mockConfig,
            telemetry: mockTelemetry,
            elicitation: mockElicitation,
            metrics: new MockMetrics(),
            uiRegistry: new UIRegistry(),
        };

        tool = new ListAlertsTool(params);
    });

    const baseArgs = { projectId: "proj1", status: "OPEN" as const, limit: 100, pageNum: 1 };
    // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
    const exec = (args: Record<string, unknown>) => tool["execute"](args as never);

    it("should return alerts when they exist", async () => {
        mockApiClient.listAlerts!.mockResolvedValue({
            results: [
                {
                    id: "alert1",
                    status: "OPEN",
                    created: "2025-01-01T00:00:00Z",
                    updated: "2025-01-02T00:00:00Z",
                    eventTypeName: "HOST_DOWN",
                    acknowledgementComment: null,
                },
                {
                    id: "alert2",
                    status: "OPEN",
                    created: "2025-01-03T00:00:00Z",
                    updated: "2025-01-04T00:00:00Z",
                    eventTypeName: "REPLICATION_OPLOG_WINDOW_RUNNING_OUT",
                    acknowledgementComment: "investigating",
                },
            ],
            totalCount: 2,
        });

        const result = await exec({ ...baseArgs });

        const text = (result.content[0] as { text: string }).text;
        expect(text).toContain("Found 2 alerts");
        expect(text).toContain("total: 2");
        expect(text).toContain("proj1");
    });

    it("should return empty message when no alerts found", async () => {
        mockApiClient.listAlerts!.mockResolvedValue({ results: [] });

        const result = await exec({ ...baseArgs });

        const text = (result.content[0] as { text: string }).text;
        expect(text).toContain('No alerts with status "OPEN"');
    });

    it("should pass status to API", async () => {
        mockApiClient.listAlerts!.mockResolvedValue({ results: [], totalCount: 0 });

        await exec({ ...baseArgs, status: "CLOSED" });

        expect(mockApiClient.listAlerts).toHaveBeenCalledWith({
            params: {
                path: { groupId: "proj1" },
                query: { status: "CLOSED", itemsPerPage: 100, pageNum: 1, includeCount: true },
            },
        });
    });

    it("should pass limit and pageNum to API", async () => {
        mockApiClient.listAlerts!.mockResolvedValue({ results: [], totalCount: 0 });

        await exec({ ...baseArgs, limit: 10, pageNum: 3 });

        expect(mockApiClient.listAlerts).toHaveBeenCalledWith({
            params: {
                path: { groupId: "proj1" },
                query: { status: "OPEN", itemsPerPage: 10, pageNum: 3, includeCount: true },
            },
        });
    });

    it("should include totalCount in response header", async () => {
        mockApiClient.listAlerts!.mockResolvedValue({
            results: [
                {
                    id: "alert1",
                    status: "OPEN",
                    created: "2025-01-01T00:00:00Z",
                    updated: "2025-01-02T00:00:00Z",
                    eventTypeName: "HOST_DOWN",
                },
            ],
            totalCount: 42,
        });

        const result = await exec({ ...baseArgs });

        const text = (result.content[0] as { text: string }).text;
        expect(text).toContain("total: 42");
    });

    it("should format alert fields correctly", async () => {
        mockApiClient.listAlerts!.mockResolvedValue({
            results: [
                {
                    id: "alert-abc",
                    status: "OPEN",
                    created: "2025-06-15T10:30:00Z",
                    updated: "2025-06-16T12:00:00Z",
                    eventTypeName: "HOST_DOWN",
                    acknowledgementComment: "looking into it",
                },
            ],
            totalCount: 1,
        });

        const result = await exec({ ...baseArgs });

        const text = result.content.map((c) => (c as { text: string }).text).join("\n");
        expect(text).toContain("alert-abc");
        expect(text).toContain("HOST_DOWN");
        expect(text).toContain("looking into it");
    });

    it("should handle null results gracefully", async () => {
        mockApiClient.listAlerts!.mockResolvedValue({ results: null });

        const result = await exec({ ...baseArgs });

        const text = (result.content[0] as { text: string }).text;
        expect(text).toContain("No alerts with status");
    });

    it("should handle missing acknowledgementComment", async () => {
        mockApiClient.listAlerts!.mockResolvedValue({
            results: [
                {
                    id: "alert1",
                    status: "OPEN",
                    created: "2025-01-01T00:00:00Z",
                    updated: "2025-01-02T00:00:00Z",
                    eventTypeName: "HOST_DOWN",
                    acknowledgementComment: null,
                },
            ],
            totalCount: 1,
        });

        const result = await exec({ ...baseArgs });

        const text = result.content.map((c) => (c as { text: string }).text).join("\n");
        expect(text).toContain("N/A");
    });
});
