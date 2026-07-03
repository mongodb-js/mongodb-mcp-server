import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ToolConstructorParams } from "../../../../../src/tools/tool.js";
import { ListOrganizationsTool } from "../../../../../src/tools/atlas/read/listOrgs.js";
import type { Session } from "../../../../../src/common/session.js";
import type { UserConfig } from "../../../../../src/common/config/userConfig.js";
import type { Telemetry } from "../../../../../src/telemetry/telemetry.js";
import type { Elicitation } from "../../../../../src/elicitation.js";
import type { CompositeLogger } from "../../../../../src/common/logging/index.js";
import type { ApiClient } from "../../../../../src/common/atlas/apiClient.js";
import { UIRegistry } from "../../../../../src/ui/registry/index.js";
import { MockMetrics } from "../../../mocks/metrics.js";

describe("ListOrganizationsTool", () => {
    let mockApiClient: Record<string, ReturnType<typeof vi.fn>>;
    let tool: ListOrganizationsTool;

    beforeEach(() => {
        mockApiClient = {
            listOrgs: vi.fn(),
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
            name: ListOrganizationsTool.toolName,
            category: "atlas",
            operationType: ListOrganizationsTool.operationType,
            session: mockSession,
            config: mockConfig,
            telemetry: mockTelemetry,
            elicitation: mockElicitation,
            metrics: new MockMetrics(),
            uiRegistry: new UIRegistry(),
        };

        tool = new ListOrganizationsTool(params);
    });

    // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
    const exec = () => tool["execute"]({} as never, { signal: new AbortController().signal } as never);

    it("returns organizations when they exist", async () => {
        mockApiClient.listOrgs!.mockResolvedValue({
            results: [
                { name: "Org A", id: "org-a" },
                { name: "Org B", id: "org-b" },
            ],
        });

        const result = await exec();

        const text = result.content.map((c) => (c as { text: string }).text).join("\n");
        expect(text).toContain("Found 2 organizations in your MongoDB Atlas account.");
        expect(text).toContain("Org A");
        expect(text).toContain("Org B");
        expect(text).toContain("<untrusted-user-data-");
    });

    it("returns empty message when no organizations found", async () => {
        mockApiClient.listOrgs!.mockResolvedValue({ results: [] });

        const result = await exec();

        expect((result.content[0] as { text: string }).text).toBe(
            "No organizations found in your MongoDB Atlas account."
        );
    });

    it("calls listOrgs API", async () => {
        mockApiClient.listOrgs!.mockResolvedValue({ results: [] });

        await exec();

        expect(mockApiClient.listOrgs).toHaveBeenCalledWith(undefined, expect.anything());
    });

    it("handles null results gracefully", async () => {
        mockApiClient.listOrgs!.mockResolvedValue({ results: null });

        const result = await exec();

        expect((result.content[0] as { text: string }).text).toBe(
            "No organizations found in your MongoDB Atlas account."
        );
    });

    describe("structuredContent", () => {
        it("returns organizations and totalCount on success", async () => {
            mockApiClient.listOrgs!.mockResolvedValue({
                results: [
                    { name: "Org A", id: "org-a" },
                    { name: "Org B", id: "org-b" },
                ],
            });

            const result = await exec();

            expect(result.structuredContent).toEqual({
                organizations: [
                    { name: "Org A", id: "org-a" },
                    { name: "Org B", id: "org-b" },
                ],
                totalCount: 2,
            });
        });

        it("returns empty organizations when no results", async () => {
            mockApiClient.listOrgs!.mockResolvedValue({ results: [] });

            const result = await exec();

            expect(result.structuredContent).toEqual({
                organizations: [],
                totalCount: 0,
            });
        });

        it("omits structuredContent on error paths", async () => {
            mockApiClient.listOrgs!.mockRejectedValue(new Error("API failure"));

            await expect(exec()).rejects.toThrow("API failure");
        });
    });
});
