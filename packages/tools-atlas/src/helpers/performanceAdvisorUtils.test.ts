import { describe, it, expect, vi } from "vitest";
import {
    getSuggestedIndexes,
    getDropIndexSuggestions,
    getSchemaAdvice,
    getSlowQueries,
} from "./performanceAdvisorUtils.js";
import type { ApiClient } from "@mongodb-js/mcp-atlas-api-client";

function makeApiClient(overrides: Partial<Record<string, ReturnType<typeof vi.fn>>>): ApiClient & {
    logger: { debug: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };
} {
    const debug = vi.fn();
    const error = vi.fn();
    return {
        listClusterSuggestedIndexes: vi.fn().mockRejectedValue(new Error("fail")),
        listDropIndexSuggestions: vi.fn().mockRejectedValue(new Error("fail")),
        listSchemaAdvice: vi.fn().mockRejectedValue(new Error("fail")),
        listSlowQueryLogs: vi.fn().mockRejectedValue(new Error("fail")),
        getCluster: vi.fn().mockRejectedValue(new Error("fail")),
        getFlexCluster: vi.fn().mockRejectedValue(new Error("fail")),
        logger: { debug, error },
        ...overrides,
    } as unknown as ApiClient & { logger: { debug: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> } };
}

describe("performanceAdvisorUtils debug logging", () => {
    it("getSuggestedIndexes logs a debug message on failure", async () => {
        const apiClient = makeApiClient({});
        await expect(getSuggestedIndexes(apiClient, "proj1", "cluster1")).rejects.toThrow();
        expect(apiClient.logger.debug).toHaveBeenCalledWith(
            expect.objectContaining({
                message: expect.stringContaining("Failed to list suggested indexes"), // eslint-disable-line @typescript-eslint/no-unsafe-assignment
            })
        );
    });

    it("getDropIndexSuggestions logs a debug message on failure", async () => {
        const apiClient = makeApiClient({});
        await expect(getDropIndexSuggestions(apiClient, "proj1", "cluster1")).rejects.toThrow();
        expect(apiClient.logger.debug).toHaveBeenCalledWith(
            expect.objectContaining({
                message: expect.stringContaining("Failed to list drop index suggestions"), // eslint-disable-line @typescript-eslint/no-unsafe-assignment
            })
        );
    });

    it("getSchemaAdvice logs a debug message on failure", async () => {
        const apiClient = makeApiClient({});
        await expect(getSchemaAdvice(apiClient, "proj1", "cluster1")).rejects.toThrow();
        expect(apiClient.logger.debug).toHaveBeenCalledWith(
            expect.objectContaining({
                message: expect.stringContaining("Failed to list schema advice"), // eslint-disable-line @typescript-eslint/no-unsafe-assignment
            })
        );
    });

    it("getSlowQueries logs a debug message on failure", async () => {
        // getProcessIdsFromCluster calls getCluster then getFlexCluster; when both fail the catch
        // block in getSlowQueries fires and logs.
        const apiClient = makeApiClient({});
        await expect(getSlowQueries(apiClient, "proj1", "cluster1")).rejects.toThrow();
        expect(apiClient.logger.debug).toHaveBeenCalledWith(
            expect.objectContaining({
                message: expect.stringContaining("Failed to list slow query logs"), // eslint-disable-line @typescript-eslint/no-unsafe-assignment
            })
        );
    });
});
