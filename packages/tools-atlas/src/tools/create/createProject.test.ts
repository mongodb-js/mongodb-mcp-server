import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";
import { CreateProjectTool } from "./createProject.js";
import type { ITelemetry, ICompositeLogger } from "@mongodb-js/mcp-types";
import type { ApiClient } from "@mongodb-js/mcp-atlas-api-client";
import { MockMetrics, createMockElicitation } from "@mongodb-js/mcp-test-utils";
import { Keychain } from "@mongodb-js/mcp-core";
import { UIRegistry } from "@mongodb-js/mcp-ui";
import type { AtlasToolServer } from "../../atlasTool.js";

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
        } as unknown as ICompositeLogger;

        const mockSession = {
            logger: mockLogger,
            apiClient: mockApiClient as unknown as ApiClient,
            keychain: new Keychain(),
        } as unknown as AtlasToolServer;

        const server: AtlasToolServer = {
            ...mockSession,
            telemetry: { isTelemetryEnabled: () => false, emitEvents: vi.fn() } as unknown as ITelemetry,
            elicitation: createMockElicitation(),
            metrics: new MockMetrics(),
            uiRegistry: new UIRegistry(),
        };

        tool = new CreateProjectTool({ server });
    });

    // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
    const exec = (args: Record<string, unknown> = {}) =>
        tool["execute"](args as never, {
            request: {
                signal: new AbortController().signal,
            },
        });

    it("requires projectName and orgId, rejecting missing values", () => {
        const schema = z.object(tool.argsShape);
        const validOrgId = "66c5c66592100e05467ebfad";

        expect(schema.safeParse({}).success).toBe(false);
        expect(schema.safeParse({ projectName: "My Project" }).success).toBe(false);
        expect(schema.safeParse({ orgId: validOrgId }).success).toBe(false);
        expect(schema.safeParse({ projectName: "My Project", orgId: validOrgId }).success).toBe(true);
    });

    it("creates a project with the provided name and organizationId", async () => {
        mockApiClient.createGroup!.mockResolvedValue({ id: "proj-123", name: "My Project", orgId: "org-1" });

        const result = await exec({ projectName: "My Project", orgId: "org-1" });

        expect((result.content[0] as { text: string }).text).toContain('Project "My Project" created successfully');
        expect(mockApiClient.listOrgs).not.toHaveBeenCalled();
        expect(mockApiClient.createGroup).toHaveBeenCalledWith(
            { body: { name: "My Project", orgId: "org-1" } },
            expect.anything()
        );
        expect(result.structuredContent).toEqual({
            projectName: "My Project",
            orgId: "org-1",
        });
    });

    it("throws when createGroup returns no id", async () => {
        mockApiClient.createGroup!.mockResolvedValue({});

        await expect(exec({ projectName: "My Project", orgId: "org-1" })).rejects.toThrow("Failed to create project");
    });
});
