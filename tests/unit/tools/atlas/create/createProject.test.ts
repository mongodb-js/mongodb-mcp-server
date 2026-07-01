import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ToolConstructorParams } from "../../../../../src/tools/tool.js";
import { CreateProjectTool } from "../../../../../src/tools/atlas/create/createProject.js";
import type { Session } from "../../../../../src/common/session.js";
import type { UserConfig } from "../../../../../src/common/config/userConfig.js";
import type { Telemetry } from "../../../../../src/telemetry/telemetry.js";
import type { Elicitation } from "../../../../../src/elicitation.js";
import type { CompositeLogger } from "../../../../../src/common/logging/index.js";
import type { ApiClient } from "../../../../../src/common/atlas/apiClient.js";
import { UIRegistry } from "../../../../../src/ui/registry/index.js";
import { MockMetrics } from "../../../mocks/metrics.js";

describe("CreateProjectTool", () => {
    let mockApiClient: Record<string, ReturnType<typeof vi.fn>>;
    let tool: CreateProjectTool;

    beforeEach(() => {
        mockApiClient = {
            listOrgs: vi.fn(),
            createGroup: vi.fn(),
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

        const params: ToolConstructorParams = {
            name: CreateProjectTool.toolName,
            category: "atlas",
            operationType: CreateProjectTool.operationType,
            session: mockSession,
            config: {
                confirmationRequiredTools: [],
                previewFeatures: [],
                disabledTools: [],
                apiClientId: "test-id",
                apiClientSecret: "test-secret",
            } as unknown as UserConfig,
            telemetry: { isTelemetryEnabled: () => false, emitEvents: vi.fn() } as unknown as Telemetry,
            elicitation: { requestConfirmation: vi.fn() } as unknown as Elicitation,
            metrics: new MockMetrics(),
            uiRegistry: new UIRegistry(),
        };

        tool = new CreateProjectTool(params);
    });

    // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
    const exec = (args: Record<string, unknown> = {}) =>
        tool["execute"](args as never, { signal: new AbortController().signal } as never);

    it("creates a project with explicit organizationId", async () => {
        mockApiClient.createGroup!.mockResolvedValue({ id: "proj-123", name: "My Project", orgId: "org-1" });

        const result = await exec({ projectName: "My Project", organizationId: "org-1" });

        expect((result.content[0] as { text: string }).text).toContain('Project "My Project" created successfully');
        expect(mockApiClient.listOrgs).not.toHaveBeenCalled();
        expect(result.structuredContent).toEqual({
            projectName: "My Project",
        });
    });

    it("assumes first organization when organizationId is omitted", async () => {
        mockApiClient.listOrgs!.mockResolvedValue({ results: [{ id: "org-first", name: "First Org" }] });
        mockApiClient.createGroup!.mockResolvedValue({ id: "proj-456", name: "Atlas Project", orgId: "org-first" });

        const result = await exec();

        expect(mockApiClient.listOrgs).toHaveBeenCalled();
        expect((result.content[0] as { text: string }).text).toContain("using organizationId org-first");
        expect(result.structuredContent).toEqual({
            projectName: "Atlas Project",
            organizationId: "org-first",
        });
    });

    it("uses default project name when projectName is omitted", async () => {
        mockApiClient.listOrgs!.mockResolvedValue({ results: [{ id: "org-1", name: "Org" }] });
        mockApiClient.createGroup!.mockResolvedValue({ id: "proj-789", name: "Atlas Project", orgId: "org-1" });

        const result = await exec({ organizationId: "org-1" });

        expect(result.structuredContent?.projectName).toBe("Atlas Project");
    });

    it("throws when createGroup returns no id", async () => {
        mockApiClient.createGroup!.mockResolvedValue({});

        await expect(exec({ projectName: "My Project", organizationId: "org-1" })).rejects.toThrow(
            "Failed to create project"
        );
    });
});
