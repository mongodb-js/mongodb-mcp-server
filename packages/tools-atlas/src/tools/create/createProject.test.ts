import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ToolConstructorParams } from "@mongodb-js/mcp-core";
import { CreateProjectTool } from "./createProject.js";
import type { IAtlasSession, IAtlasConfig } from "../../atlasTool.js";
import type { ITelemetry, IElicitation, ICompositeLogger } from "@mongodb-js/mcp-types";
import type { ApiClient } from "@mongodb-js/mcp-atlas-api-client";
import { MockMetrics } from "../../mockMetrics.js";
import { Keychain } from "@mongodb-js/mcp-core";

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
            setAttribute: vi.fn(),
            addLogger: vi.fn(),
        } as unknown as ICompositeLogger;

        const mockSession = {
            sessionId: "test-session",
            logger: mockLogger,
            apiClient: mockApiClient as unknown as ApiClient,
            connectedAtlasCluster: undefined,
            connectToMongoDB: vi.fn().mockResolvedValue(undefined),
            keychain: new Keychain(),
            config: {
                apiClientId: "test-id",
                apiClientSecret: "test-secret",
            } as unknown as IAtlasConfig,
            disconnect: vi.fn().mockResolvedValue(undefined),
            close: vi.fn().mockResolvedValue(undefined),
            isConnectedToMongoDB: false,
            on: vi.fn(),
            setMcpClient: vi.fn(),
        } as unknown as IAtlasSession;

        const params: ToolConstructorParams<IAtlasSession> = {
            name: CreateProjectTool.toolName,
            category: "atlas",
            operationType: CreateProjectTool.operationType,
            session: mockSession,
            telemetry: { isTelemetryEnabled: () => false, emitEvents: vi.fn() } as unknown as ITelemetry,
            elicitation: { requestConfirmation: vi.fn() } as unknown as IElicitation,
            metrics: new MockMetrics(),
        };

        tool = new CreateProjectTool(params);
    });

    // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
    const exec = (args: Record<string, unknown> = {}) => tool["execute"](args as never);

    it("creates a project with explicit orgId", async () => {
        mockApiClient.createGroup!.mockResolvedValue({ id: "proj-123", name: "My Project", orgId: "org-1" });

        const result = await exec({ projectName: "My Project", orgId: "org-1" });

        expect((result.content[0] as { text: string }).text).toContain('Project "My Project" created successfully');
        expect(mockApiClient.listOrgs).not.toHaveBeenCalled();
    });

    it("assumes first organization when orgId is omitted", async () => {
        mockApiClient.listOrgs!.mockResolvedValue({ results: [{ id: "org-first", name: "First Org" }] });
        mockApiClient.createGroup!.mockResolvedValue({ id: "proj-456", name: "Atlas Project", orgId: "org-first" });

        const result = await exec();

        expect(mockApiClient.listOrgs).toHaveBeenCalled();
        expect((result.content[0] as { text: string }).text).toContain("using orgId org-first");
    });

    it("uses default project name when projectName is omitted", async () => {
        mockApiClient.listOrgs!.mockResolvedValue({ results: [{ id: "org-1", name: "Org" }] });
        mockApiClient.createGroup!.mockResolvedValue({
            id: "proj-789",
            name: "Atlas Project",
            orgId: "org-1",
        });

        await exec({ orgId: "org-1" });

        expect(mockApiClient.createGroup).toHaveBeenCalledWith(
            expect.objectContaining({
                body: expect.objectContaining({ name: "Atlas Project" }), // eslint-disable-line @typescript-eslint/no-unsafe-assignment
            })
        );
    });

    it("throws when createGroup returns no id", async () => {
        mockApiClient.createGroup!.mockResolvedValue({});

        await expect(exec({ projectName: "My Project", orgId: "org-1" })).rejects.toThrow("Failed to create project");
    });
});
