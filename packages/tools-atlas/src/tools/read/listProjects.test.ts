import { z } from "zod";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ToolConstructorParams } from "@mongodb-js/mcp-core";
import { ListProjectsTool, ListProjectsArgs } from "./listProjects.js";
import type { IAtlasSession } from "../../atlasTool.js";
import type { ITelemetry } from "@mongodb-js/mcp-types";
import type { Elicitation } from "@mongodb-js/mcp-core";
import type { CompositeLogger } from "@mongodb-js/mcp-core";
import type { ApiClient } from "@mongodb-js/mcp-atlas-api-client";
import { UIRegistry } from "@mongodb-js/mcp-ui";
import { MockMetrics } from "@mongodb-js/mcp-test-utils";

const orgId = "507f1f77bcf86cd799439011";

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
    created: new Date(projectApiResponse.created).toLocaleString(),
};

describe("ListProjectsTool", () => {
    let mockApiClient: Record<string, ReturnType<typeof vi.fn>>;
    let tool: ListProjectsTool;

    beforeEach(() => {
        mockApiClient = {
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
        } as unknown as IAtlasSession;

        const mockTelemetry = {
            isTelemetryEnabled: () => true,
            emitEvents: vi.fn(),
        } as unknown as ITelemetry;

        const mockElicitation = {
            requestConfirmation: vi.fn(),
        } as unknown as Elicitation;

        const params: ToolConstructorParams<IAtlasSession> = {
            name: ListProjectsTool.toolName,
            category: "atlas",
            operationType: ListProjectsTool.operationType,
            session: mockSession,
            telemetry: mockTelemetry,
            elicitation: mockElicitation,
            metrics: new MockMetrics(),
            uiRegistry: new UIRegistry(),
        };

        tool = new ListProjectsTool(params);
    });

    // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
    const exec = (args: Record<string, unknown> = {}) =>
        tool["execute"]({ limit: 10, pageNum: 1, includeCount: false, ...args } as never, {
            signal: new AbortController().signal,
        });

    it("returns projects when orgId filter is provided", async () => {
        mockApiClient.getOrgGroups!.mockResolvedValue({ results: [projectApiResponse], totalCount: 1 });

        const result = await exec({ orgId });

        const text = result.content.map((c) => (c as { text: string }).text).join("\n");
        expect(text).toContain("Found 1 projects.");
        expect(text).not.toContain("of 1");
        expect(text).toContain("my-project");
        expect(text).toContain("<untrusted-user-data-");
    });

    it("returns projects for all orgs when orgId is omitted", async () => {
        mockApiClient.listGroups!.mockResolvedValue({ results: [projectApiResponse], totalCount: 1 });

        const result = await exec();

        const text = result.content.map((c) => (c as { text: string }).text).join("\n");
        expect(text).toContain("Found 1 projects.");
        expect(mockApiClient.getOrgGroups).not.toHaveBeenCalled();
        expect(mockApiClient.listGroups).toHaveBeenCalledWith(
            { params: { query: { itemsPerPage: 10, pageNum: 1, includeCount: false } } },
            expect.anything()
        );
    });

    it("calls getOrgGroups when orgId is provided", async () => {
        mockApiClient.getOrgGroups!.mockResolvedValue({ results: [], totalCount: 0 });

        await exec({ orgId });

        expect(mockApiClient.getOrgGroups).toHaveBeenCalledWith(
            {
                params: {
                    path: { orgId },
                    query: { itemsPerPage: 10, pageNum: 1, includeCount: false },
                },
            },
            expect.anything()
        );
    });

    it("requests includeCount when the caller opts in", async () => {
        mockApiClient.getOrgGroups!.mockResolvedValue({ results: [], totalCount: 0 });

        await exec({ orgId, includeCount: true });

        expect(mockApiClient.getOrgGroups).toHaveBeenCalledWith(
            {
                params: {
                    path: { orgId },
                    query: { itemsPerPage: 10, pageNum: 1, includeCount: true },
                },
            },
            expect.anything()
        );
    });

    it("defaults limit/pageNum to 10/1 when the caller passes no args, same as the real MCP client path", async () => {
        mockApiClient.listGroups!.mockResolvedValue({ results: [], totalCount: 0 });

        // The real invocation path parses incoming args against argsShape (applying zod
        // defaults) before execute() ever runs; exec() here calls execute() directly, so
        // we replicate that parsing step to prove the defaults are actually 10/1.
        const parsedArgs = z.object(ListProjectsArgs).parse({});
        await exec(parsedArgs);

        expect(mockApiClient.listGroups).toHaveBeenCalledWith(
            { params: { query: { itemsPerPage: 10, pageNum: 1, includeCount: false } } },
            expect.anything()
        );
    });

    it("passes limit and pageNum to getOrgGroups", async () => {
        mockApiClient.getOrgGroups!.mockResolvedValue({ results: [], totalCount: 0 });

        await exec({ orgId, limit: 25, pageNum: 2 });

        expect(mockApiClient.getOrgGroups).toHaveBeenCalledWith(
            {
                params: {
                    path: { orgId },
                    query: { itemsPerPage: 25, pageNum: 2, includeCount: false },
                },
            },
            expect.anything()
        );
    });

    it("passes limit and pageNum to listGroups", async () => {
        mockApiClient.listGroups!.mockResolvedValue({ results: [], totalCount: 0 });

        await exec({ limit: 25, pageNum: 2 });

        expect(mockApiClient.listGroups).toHaveBeenCalledWith(
            { params: { query: { itemsPerPage: 25, pageNum: 2, includeCount: false } } },
            expect.anything()
        );
    });

    it("returns empty message when org has no projects", async () => {
        mockApiClient.getOrgGroups!.mockResolvedValue({ results: [], totalCount: 0 });

        const result = await exec({ orgId });

        expect((result.content[0] as { text: string }).text).toBe(`No projects found in organization ${orgId}.`);
    });

    it("returns empty message without orgId when listing projects for all orgs", async () => {
        mockApiClient.listGroups!.mockResolvedValue({ results: [], totalCount: 0 });

        const result = await exec();

        expect((result.content[0] as { text: string }).text).toBe("No projects found in your MongoDB Atlas account.");
    });

    it("uses N/A for created when project has no created date", async () => {
        mockApiClient.getOrgGroups!.mockResolvedValue({
            results: [{ ...projectApiResponse, created: undefined }],
            totalCount: 1,
        });

        const result = await exec({ orgId });

        expect(result.structuredContent?.projects[0]?.created).toBe("N/A");
    });

    describe("structuredContent", () => {
        it("reports the API total count so callers know more pages may exist", async () => {
            mockApiClient.getOrgGroups!.mockResolvedValue({ results: [projectApiResponse], totalCount: 13 });

            const result = await exec({ orgId });

            expect(result.structuredContent).toEqual({
                orgId,
                projects: [formattedProject],
                totalCount: 13,
            });

            const text = result.content.map((c) => (c as { text: string }).text).join("\n");
            expect(text).toContain("Use pagination arguments if more results are expected.");
        });

        it("does not suggest pagination when all projects are returned", async () => {
            mockApiClient.getOrgGroups!.mockResolvedValue({ results: [projectApiResponse], totalCount: 1 });

            const result = await exec({ orgId });

            const text = result.content.map((c) => (c as { text: string }).text).join("\n");
            expect(text).toContain("Found 1 projects.");
            expect(text).not.toContain("pagination");
            expect(text).not.toContain("of 1");
        });

        it("does not suggest pagination on the last page", async () => {
            mockApiClient.getOrgGroups!.mockResolvedValue({
                results: [projectApiResponse],
                totalCount: 11,
            });

            // Page 2 of 2: page 1 returned 10 of 11, this page returns the remaining 1.
            const result = await exec({ orgId, limit: 10, pageNum: 2 });

            const text = result.content.map((c) => (c as { text: string }).text).join("\n");
            expect(text).toContain("Found 1 projects.");
            expect(text).not.toContain("pagination");
            expect(text).not.toContain("of 11");
        });

        it("suggests pagination on a middle page", async () => {
            mockApiClient.getOrgGroups!.mockResolvedValue({
                results: [projectApiResponse],
                totalCount: 25,
            });

            // Page 2 of 3: pages 1-2 returned 20 of 25, page 3 still has more.
            const result = await exec({ orgId, limit: 10, pageNum: 2 });

            const text = result.content.map((c) => (c as { text: string }).text).join("\n");
            expect(text).toContain("Use pagination arguments if more results are expected.");
        });

        it("falls back to the number of projects returned when totalCount is missing", async () => {
            mockApiClient.listGroups!.mockResolvedValue({ results: [projectApiResponse] });

            const result = await exec();

            expect(result.structuredContent).toEqual({
                projects: [formattedProject],
                totalCount: 1,
            });
            expect(result.structuredContent).not.toHaveProperty("orgId");

            const text = result.content.map((c) => (c as { text: string }).text).join("\n");
            expect(text).not.toContain("pagination");
        });

        it("suggests pagination on a full page when totalCount is missing", async () => {
            mockApiClient.getOrgGroups!.mockResolvedValue({
                results: Array.from({ length: 10 }, (_, i) => ({ ...projectApiResponse, name: `proj-${i}` })),
            });

            const result = await exec({ orgId, limit: 10 });

            const text = result.content.map((c) => (c as { text: string }).text).join("\n");
            expect(text).toContain("Use pagination arguments if more results are expected.");
        });

        it("returns empty projects when org has no projects", async () => {
            mockApiClient.getOrgGroups!.mockResolvedValue({ results: [], totalCount: 0 });

            const result = await exec({ orgId });

            expect(result.structuredContent).toEqual({
                orgId,
                projects: [],
                totalCount: 0,
            });
        });

        it("treats an explicit totalCount of 0 with results as unknown and falls back to the page length", async () => {
            // Some environments return totalCount: 0 with includeCount=false even when
            // results are present; the tool should not report 0 in that case.
            mockApiClient.listGroups!.mockResolvedValue({
                results: [projectApiResponse],
                totalCount: 0,
            });

            const result = await exec();

            expect(result.structuredContent).toEqual({
                projects: [formattedProject],
                totalCount: 1,
            });
        });

        it("omits structuredContent on error paths", async () => {
            mockApiClient.getOrgGroups!.mockRejectedValue(new Error("API failure"));

            await expect(exec({ orgId })).rejects.toThrow("API failure");
        });
    });
});
