import { z } from "zod";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ListOrganizationsTool, ListOrganizationsArgs } from "./listOrgs.js";
import type { ITelemetry } from "@mongodb-js/mcp-types";
import type { Elicitation } from "@mongodb-js/mcp-core";
import type { CompositeLogger } from "@mongodb-js/mcp-core";
import type { ApiClient } from "@mongodb-js/mcp-atlas-api-client";
import { UIRegistry } from "@mongodb-js/mcp-ui";
import { MockMetrics, createMockElicitation } from "@mongodb-js/mcp-test-utils";
import type { AtlasToolServer } from "../../atlasTool.js";
import type { ToolExecutionContext } from "@mongodb-js/mcp-types";

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
        } as unknown as AtlasToolServer;

        const mockTelemetry = {
            isTelemetryEnabled: () => true,
            emitEvents: vi.fn(),
        } as unknown as ITelemetry;

        const mockElicitation = createMockElicitation() as unknown as Elicitation;

        const server: AtlasToolServer = {
            ...mockSession,
            telemetry: mockTelemetry,
            elicitation: mockElicitation,
            metrics: new MockMetrics(),
            uiRegistry: new UIRegistry(),
        } as unknown as AtlasToolServer;

        tool = new ListOrganizationsTool(server);
    });

    // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
    const exec = (args: Record<string, unknown> = {}) =>
        tool["execute"](
            { limit: 10, pageNum: 1, includeCount: false, ...args },
            {
                request: {
                    server: (tool as unknown as { server: AtlasToolServer }).server,
                    signal: new AbortController().signal,
                },
                } as unknown as ToolExecutionContext
        );

    it("returns organizations when they exist", async () => {
        mockApiClient.listOrgs!.mockResolvedValue({
            results: [
                { name: "Org A", id: "org-a" },
                { name: "Org B", id: "org-b" },
            ],
            totalCount: 2,
        });

        const result = await exec();

        const text = result.content.map((c) => (c as { text: string }).text).join("\n");
        expect(text).toContain("Found 2 organizations in your MongoDB Atlas account.");
        expect(text).not.toContain("of 2");
        expect(text).toContain("Org A");
        expect(text).toContain("Org B");
        expect(text).toContain("<untrusted-user-data-");
    });

    it("returns empty message when no organizations found", async () => {
        mockApiClient.listOrgs!.mockResolvedValue({ results: [], totalCount: 0 });

        const result = await exec();

        expect((result.content[0] as { text: string }).text).toBe(
            "No organizations found in your MongoDB Atlas account."
        );
    });

    it("does not request includeCount from the API by default", async () => {
        mockApiClient.listOrgs!.mockResolvedValue({ results: [], totalCount: 0 });

        await exec();

        expect(mockApiClient.listOrgs).toHaveBeenCalledWith(
            { params: { query: { itemsPerPage: 10, pageNum: 1, includeCount: false } } },
            expect.anything()
        );
    });

    it("requests includeCount from the API when the caller opts in", async () => {
        mockApiClient.listOrgs!.mockResolvedValue({ results: [], totalCount: 0 });

        await exec({ includeCount: true });

        expect(mockApiClient.listOrgs).toHaveBeenCalledWith(
            { params: { query: { itemsPerPage: 10, pageNum: 1, includeCount: true } } },
            expect.anything()
        );
    });

    it("defaults limit/pageNum to 10/1 when the caller passes no args, same as the real MCP client path", async () => {
        mockApiClient.listOrgs!.mockResolvedValue({ results: [], totalCount: 0 });

        // The real invocation path parses incoming args against argsShape (applying zod
        // defaults) before execute() ever runs; exec() here calls execute() directly, so
        // we replicate that parsing step to prove the defaults are actually 10/1.
        const parsedArgs = z.object(ListOrganizationsArgs).parse({});
        await exec(parsedArgs);

        expect(mockApiClient.listOrgs).toHaveBeenCalledWith(
            { params: { query: { itemsPerPage: 10, pageNum: 1, includeCount: false } } },
            expect.anything()
        );
    });

    it("passes limit and pageNum to the API", async () => {
        mockApiClient.listOrgs!.mockResolvedValue({ results: [], totalCount: 0 });

        await exec({ limit: 10, pageNum: 3 });

        expect(mockApiClient.listOrgs).toHaveBeenCalledWith(
            { params: { query: { itemsPerPage: 10, pageNum: 3, includeCount: false } } },
            expect.anything()
        );
    });

    it("handles null results gracefully", async () => {
        mockApiClient.listOrgs!.mockResolvedValue({ results: null, totalCount: 0 });

        const result = await exec();

        expect((result.content[0] as { text: string }).text).toBe(
            "No organizations found in your MongoDB Atlas account."
        );
    });

    describe("structuredContent", () => {
        it("returns the API-reported total count so callers know more pages may exist", async () => {
            mockApiClient.listOrgs!.mockResolvedValue({
                results: [
                    { name: "Org A", id: "org-a" },
                    { name: "Org B", id: "org-b" },
                ],
                // Total across all pages, distinct from what this page returned.
                totalCount: 13,
            });

            const result = await exec();

            expect(result.structuredContent).toEqual({
                organizations: [
                    { name: "Org A", id: "org-a" },
                    { name: "Org B", id: "org-b" },
                ],
                totalCount: 13,
            });

            const text = result.content.map((c) => (c as { text: string }).text).join("\n");
            expect(text).toContain("Use pagination arguments if more results are expected.");
        });

        it("does not suggest pagination when all organizations are returned", async () => {
            mockApiClient.listOrgs!.mockResolvedValue({
                results: [
                    { name: "Org A", id: "org-a" },
                    { name: "Org B", id: "org-b" },
                ],
                totalCount: 2,
            });

            const result = await exec();

            const text = result.content.map((c) => (c as { text: string }).text).join("\n");
            expect(text).toContain("Found 2 organizations in your MongoDB Atlas account.");
            expect(text).not.toContain("pagination");
            expect(text).not.toContain("of 2");
        });

        it("does not suggest pagination on the last page", async () => {
            mockApiClient.listOrgs!.mockResolvedValue({
                results: [{ name: "Org A", id: "org-a" }],
                totalCount: 11,
            });

            // Page 2 of 2: page 1 returned 10 of 11, this page returns the remaining 1.
            const result = await exec({ limit: 10, pageNum: 2 });

            const text = result.content.map((c) => (c as { text: string }).text).join("\n");
            expect(text).toContain("Found 1 organizations in your MongoDB Atlas account.");
            expect(text).not.toContain("pagination");
            expect(text).not.toContain("of 11");
        });

        it("suggests pagination on a middle page", async () => {
            mockApiClient.listOrgs!.mockResolvedValue({
                results: [{ name: "Org A", id: "org-a" }],
                totalCount: 25,
            });

            // Page 2 of 3: pages 1-2 returned 20 of 25, page 3 still has more.
            const result = await exec({ limit: 10, pageNum: 2 });

            const text = result.content.map((c) => (c as { text: string }).text).join("\n");
            expect(text).toContain("Use pagination arguments if more results are expected.");
        });

        it("falls back to the number of organizations returned when totalCount is missing", async () => {
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

            const text = result.content.map((c) => (c as { text: string }).text).join("\n");
            expect(text).not.toContain("pagination");
        });

        it("suggests pagination on a full page when totalCount is missing", async () => {
            mockApiClient.listOrgs!.mockResolvedValue({
                results: Array.from({ length: 10 }, (_, i) => ({ name: `Org ${i}`, id: `org-${i}` })),
            });

            const result = await exec({ limit: 10 });

            const text = result.content.map((c) => (c as { text: string }).text).join("\n");
            expect(text).toContain("Use pagination arguments if more results are expected.");
        });

        it("returns totalCount 0 when no organizations are found", async () => {
            mockApiClient.listOrgs!.mockResolvedValue({ results: [], totalCount: 0 });

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
