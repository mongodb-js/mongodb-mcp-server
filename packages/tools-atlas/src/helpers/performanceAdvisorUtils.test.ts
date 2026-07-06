/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { describe, it, expect, vi } from "vitest";
import {
    getSuggestedIndexes,
    getDropIndexSuggestions,
    getSchemaAdvice,
    getSlowQueries,
} from "../../../src/common/atlas/performanceAdvisorUtils.js";
import type { ApiClient } from "../../../src/common/atlas/apiClient.js";

const context = { requestInfo: { headers: { "x-request-id": "req-pa-1" } } };

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

describe("performanceAdvisorUtils request ID logging", () => {
    it("getSuggestedIndexes includes x-request-id in debug log on failure", async () => {
        const apiClient = makeApiClient({});
        await expect(getSuggestedIndexes(apiClient, "proj1", "cluster1", context)).rejects.toThrow();
        expect(apiClient.logger.debug).toHaveBeenCalledWith(
            expect.objectContaining({
                attributes: expect.objectContaining({ "x-request-id": "req-pa-1" }),
            })
        );
    });

    it("getDropIndexSuggestions includes x-request-id in debug log on failure", async () => {
        const apiClient = makeApiClient({});
        await expect(getDropIndexSuggestions(apiClient, "proj1", "cluster1", context)).rejects.toThrow();
        expect(apiClient.logger.debug).toHaveBeenCalledWith(
            expect.objectContaining({
                attributes: expect.objectContaining({ "x-request-id": "req-pa-1" }),
            })
        );
    });

    it("getSchemaAdvice includes x-request-id in debug log on failure", async () => {
        const apiClient = makeApiClient({});
        await expect(getSchemaAdvice(apiClient, "proj1", "cluster1", context)).rejects.toThrow();
        expect(apiClient.logger.debug).toHaveBeenCalledWith(
            expect.objectContaining({
                attributes: expect.objectContaining({ "x-request-id": "req-pa-1" }),
            })
        );
    });

    it("getSlowQueries includes x-request-id in debug log on failure", async () => {
        // getProcessIdsFromCluster calls getCluster then getFlexCluster; when both fail the catch
        // block in getSlowQueries fires and logs with x-request-id
        const apiClient = makeApiClient({});
        await expect(getSlowQueries(apiClient, "proj1", "cluster1", undefined, undefined, context)).rejects.toThrow();
        expect(apiClient.logger.debug).toHaveBeenCalledWith(
            expect.objectContaining({
                attributes: expect.objectContaining({ "x-request-id": "req-pa-1" }),
            })
        );
    });
});
