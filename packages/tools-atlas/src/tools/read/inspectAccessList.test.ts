import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ToolConstructorParams } from "@mongodb-js/mcp-core";
import { InspectAccessListTool } from "./inspectAccessList.js";
import type { ISession } from "@mongodb-js/mcp-types";
import type { UserConfig } from "@mongodb-js/mcp-cli";
import type { ITelemetry } from "@mongodb-js/mcp-types";
import type { Elicitation } from "@mongodb-js/mcp-core";
import type { CompositeLogger } from "@mongodb-js/mcp-core";
import type { ApiClient } from "@mongodb-js/mcp-atlas-api-client";
import { UIRegistry } from "@mongodb-js/mcp-ui";
import { MockMetrics } from "@mongodb-js/mcp-test-utils";

describe("InspectAccessListTool", () => {
    let mockApiClient: Record<string, ReturnType<typeof vi.fn>>;
    let tool: InspectAccessListTool;

    beforeEach(() => {
        mockApiClient = {
            listAccessListEntries: vi.fn(),
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
        } as unknown as ISession;

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
        } as unknown as ITelemetry;

        const mockElicitation = {
            requestConfirmation: vi.fn(),
        } as unknown as Elicitation;

        const params: ToolConstructorParams = {
            name: InspectAccessListTool.toolName,
            category: "atlas",
            operationType: InspectAccessListTool.operationType,
            session: mockSession,
            telemetry: mockTelemetry,
            elicitation: mockElicitation,
            metrics: new MockMetrics(),
            uiRegistry: new UIRegistry(),
        };

        tool = new InspectAccessListTool(params);
    });

    const baseArgs = { projectId: "507f1f77bcf86cd799439011" };
    // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
    const exec = (args: Record<string, unknown>) =>
        tool["execute"](args as never, { signal: new AbortController().signal } as never);

    it("returns access list entries when they exist", async () => {
        mockApiClient.listAccessListEntries!.mockResolvedValue({
            results: [
                { ipAddress: "192.168.1.1", comment: "office" },
                { cidrBlock: "10.0.0.0/24", comment: "vpn" },
            ],
        });

        const result = await exec({ ...baseArgs });

        const text = result.content.map((c) => (c as { text: string }).text).join("\n");
        expect(text).toContain("Found 2 access list entries");
        expect(text).toContain("192.168.1.1");
        expect(text).toContain("10.0.0.0/24");
        expect(text).toContain("<untrusted-user-data-");
    });

    it("returns empty message when no entries found", async () => {
        mockApiClient.listAccessListEntries!.mockResolvedValue({ results: [] });

        const result = await exec({ ...baseArgs });

        expect((result.content[0] as { text: string }).text).toBe("No access list entries found.");
    });

    it("passes projectId to API", async () => {
        mockApiClient.listAccessListEntries!.mockResolvedValue({ results: [] });

        await exec({ ...baseArgs });

        expect(mockApiClient.listAccessListEntries).toHaveBeenCalledWith(
            {
                params: {
                    path: { groupId: baseArgs.projectId },
                },
            },
            expect.anything()
        );
    });

    it("handles null results gracefully", async () => {
        mockApiClient.listAccessListEntries!.mockResolvedValue({ results: null });

        const result = await exec({ ...baseArgs });

        expect((result.content[0] as { text: string }).text).toBe("No access list entries found.");
    });

    describe("structuredContent", () => {
        it("returns entries and totalCount on success", async () => {
            mockApiClient.listAccessListEntries!.mockResolvedValue({
                results: [{ ipAddress: "192.168.1.1", comment: "office" }, { cidrBlock: "10.0.0.0/24" }],
            });

            const result = await exec({ ...baseArgs });

            expect(result.structuredContent).toEqual({
                projectId: baseArgs.projectId,
                entries: [{ ipAddress: "192.168.1.1", comment: "office" }, { cidrBlock: "10.0.0.0/24" }],
                totalCount: 2,
            });
        });

        it("returns empty entries when no results", async () => {
            mockApiClient.listAccessListEntries!.mockResolvedValue({ results: [] });

            const result = await exec({ ...baseArgs });

            expect(result.structuredContent).toEqual({
                projectId: baseArgs.projectId,
                entries: [],
                totalCount: 0,
            });
        });

        it("omits structuredContent on error paths", async () => {
            mockApiClient.listAccessListEntries!.mockRejectedValue(new Error("API failure"));

            await expect(exec({ ...baseArgs })).rejects.toThrow("API failure");
        });
    });
});
