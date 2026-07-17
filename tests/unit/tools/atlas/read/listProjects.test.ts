import { z } from "zod";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ToolConstructorParams } from "../../../../../src/tools/tool.js";
import { ListProjectsTool, ListProjectsArgs } from "../../../../../src/tools/atlas/read/listProjects.js";
import type { Session } from "../../../../../src/common/session.js";
import type { UserConfig } from "../../../../../src/common/config/userConfig.js";
import type { Telemetry } from "../../../../../src/telemetry/telemetry.js";
import type { Elicitation } from "../../../../../src/elicitation.js";
import type { CompositeLogger } from "../../../../../src/common/logging/index.js";
import type { ApiClient } from "../../../../../src/common/atlas/apiClient.js";
import { UIRegistry } from "../../../../../src/ui/registry/index.js";
import { MockMetrics } from "../../../mocks/metrics.js";

const orgId = "507f1f77bcf86cd799439011";
const orgsResponse = {
    results: [{ id: orgId, name: "Test Org" }],
};

const projectApiResponse = {
    name: "my-project",
    id: "proj-123",
    orgId,
    created: "2025-06-15T10:30:00.000Z",
};

const formattedProject = {
    name: projectApiResponse.name,
    id: projectApiResponse.id,
    orgId: projectApiResponse.orgId,
    orgName: "Test Org",
    created: new Date(projectApiResponse.created).toLocaleString(),
};

describe("ListProjectsTool", () => {
    let mockApiClient: Record<string, ReturnType<typeof vi.fn>>;
    let tool: ListProjectsTool;

    beforeEach(() => {
        mockApiClient = {
            listOrgs: vi.fn(),
            getOrgGroups: vi.fn(),
            listGroups: vi.fn(),
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
            name: ListProjectsTool.toolName,
            category: "atlas",
            operationType: ListProjectsTool.operationType,
            session: mockSession,
            config: mockConfig,
            telemetry: mockTelemetry,
            elicitation: mockElicitation,
            metrics: new MockMetrics(),
            uiRegistry: new UIRegistry(),
        };

        tool = new ListProjectsTool(params);
    });

    // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
    const exec = (args: Record<string, unknown> = {}) =>
        tool["execute"](
            { limit: 10, pageNum: 1, ...args } as never,
            {
                signal: new AbortController().signal,
            } as never
        );

    it("returns projects when orgId filter is provided", async () => {
        mockApiClient.listOrgs!.mockResolvedValue(orgsResponse);
        mockApiClient.getOrgGroups!.mockResolvedValue({ results: [projectApiResponse] });

        const result = await exec({ orgId });

        const text = result.content.map((c) => (c as { text: string }).text).join("\n");
        expect(text).toContain("Found 1 projects");
        expect(text).toContain("my-project");
        expect(text).toContain("<untrusted-user-data-");
    });

    it("returns projects for all orgs when orgId is omitted", async () => {
        mockApiClient.listOrgs!.mockResolvedValue(orgsResponse);
        mockApiClient.listGroups!.mockResolvedValue({ results: [projectApiResponse] });

        const result = await exec();

        const text = result.content.map((c) => (c as { text: string }).text).join("\n");
        expect(text).toContain("Found 1 projects");
        expect(mockApiClient.getOrgGroups).not.toHaveBeenCalled();
        expect(mockApiClient.listGroups).toHaveBeenCalledWith(
            { params: { query: { itemsPerPage: 10, pageNum: 1 } } },
            expect.anything()
        );
    });

    it("calls getOrgGroups when orgId is provided", async () => {
        mockApiClient.listOrgs!.mockResolvedValue(orgsResponse);
        mockApiClient.getOrgGroups!.mockResolvedValue({ results: [] });

        await exec({ orgId });

        expect(mockApiClient.getOrgGroups).toHaveBeenCalledWith(
            {
                params: {
                    path: { orgId },
                    query: { itemsPerPage: 10, pageNum: 1 },
                },
            },
            expect.anything()
        );
    });

    it("bounds the internal orgId->name lookup call to the Atlas max page size", async () => {
        mockApiClient.listOrgs!.mockResolvedValue(orgsResponse);
        mockApiClient.listGroups!.mockResolvedValue({ results: [projectApiResponse] });

        await exec();

        expect(mockApiClient.listOrgs).toHaveBeenCalledWith(
            { params: { query: { itemsPerPage: 500 } } },
            expect.anything()
        );
    });

    it("defaults limit/pageNum to 10/1 when the caller passes no args, same as the real MCP client path", async () => {
        mockApiClient.listOrgs!.mockResolvedValue(orgsResponse);
        mockApiClient.listGroups!.mockResolvedValue({ results: [] });

        // The real invocation path parses incoming args against argsShape (applying zod
        // defaults) before execute() ever runs; exec() here calls execute() directly, so
        // we replicate that parsing step to prove the defaults are actually 10/1.
        const parsedArgs = z.object(ListProjectsArgs).parse({});
        await exec(parsedArgs);

        expect(mockApiClient.listGroups).toHaveBeenCalledWith(
            { params: { query: { itemsPerPage: 10, pageNum: 1 } } },
            expect.anything()
        );
    });

    it("passes limit and pageNum to getOrgGroups", async () => {
        mockApiClient.listOrgs!.mockResolvedValue(orgsResponse);
        mockApiClient.getOrgGroups!.mockResolvedValue({ results: [] });

        await exec({ orgId, limit: 25, pageNum: 2 });

        expect(mockApiClient.getOrgGroups).toHaveBeenCalledWith(
            {
                params: {
                    path: { orgId },
                    query: { itemsPerPage: 25, pageNum: 2 },
                },
            },
            expect.anything()
        );
    });

    it("passes limit and pageNum to listGroups", async () => {
        mockApiClient.listOrgs!.mockResolvedValue(orgsResponse);
        mockApiClient.listGroups!.mockResolvedValue({ results: [] });

        await exec({ limit: 25, pageNum: 2 });

        expect(mockApiClient.listGroups).toHaveBeenCalledWith(
            { params: { query: { itemsPerPage: 25, pageNum: 2 } } },
            expect.anything()
        );
    });

    it("returns empty message when no organizations exist", async () => {
        mockApiClient.listOrgs!.mockResolvedValue({ results: [] });

        const result = await exec({ orgId });

        expect((result.content[0] as { text: string }).text).toBe(
            "No organizations found in your MongoDB Atlas account."
        );
    });

    it("returns empty message when org has no projects", async () => {
        mockApiClient.listOrgs!.mockResolvedValue(orgsResponse);
        mockApiClient.getOrgGroups!.mockResolvedValue({ results: [] });

        const result = await exec({ orgId });

        expect((result.content[0] as { text: string }).text).toBe(`No projects found in organization ${orgId}.`);
    });

    it("uses N/A for orgName when org is missing from listOrgs results", async () => {
        mockApiClient.listOrgs!.mockResolvedValue({ results: [{ id: "other-org", name: "Other Org" }] });
        mockApiClient.listGroups!.mockResolvedValue({ results: [projectApiResponse] });

        const result = await exec();

        expect(result.structuredContent?.projects[0]?.orgName).toBe("N/A");
    });

    it("uses N/A for created when project has no created date", async () => {
        mockApiClient.listOrgs!.mockResolvedValue(orgsResponse);
        mockApiClient.getOrgGroups!.mockResolvedValue({
            results: [{ ...projectApiResponse, created: undefined }],
        });

        const result = await exec({ orgId });

        expect(result.structuredContent?.projects[0]?.created).toBe("N/A");
    });

    describe("structuredContent", () => {
        it("returns totalCount as the number of projects actually returned with orgId filter, ignoring any API-reported total", async () => {
            mockApiClient.listOrgs!.mockResolvedValue(orgsResponse);
            // Atlas-wide total across all pages, distinct from what this call returned -
            // must not leak into totalCount below.
            mockApiClient.getOrgGroups!.mockResolvedValue({ results: [projectApiResponse], totalCount: 999 });

            const result = await exec({ orgId });

            expect(result.structuredContent).toEqual({
                orgId,
                projects: [formattedProject],
                totalCount: 1,
            });
        });

        it("returns totalCount as the number of projects actually returned when unfiltered, ignoring any API-reported total", async () => {
            mockApiClient.listOrgs!.mockResolvedValue(orgsResponse);
            mockApiClient.listGroups!.mockResolvedValue({ results: [projectApiResponse], totalCount: 999 });

            const result = await exec();

            expect(result.structuredContent).toEqual({
                projects: [formattedProject],
                totalCount: 1,
            });
            expect(result.structuredContent).not.toHaveProperty("orgId");
        });

        it("returns empty projects when no organizations exist", async () => {
            mockApiClient.listOrgs!.mockResolvedValue({ results: [] });

            const result = await exec({ orgId });

            expect(result.structuredContent).toEqual({
                orgId,
                projects: [],
                totalCount: 0,
            });
        });

        it("returns empty projects when org has no projects", async () => {
            mockApiClient.listOrgs!.mockResolvedValue(orgsResponse);
            mockApiClient.getOrgGroups!.mockResolvedValue({ results: [] });

            const result = await exec({ orgId });

            expect(result.structuredContent).toEqual({
                orgId,
                projects: [],
                totalCount: 0,
            });
        });

        it("omits structuredContent on error paths", async () => {
            mockApiClient.listOrgs!.mockRejectedValue(new Error("API failure"));

            await expect(exec({ orgId })).rejects.toThrow("API failure");
        });
    });
});
