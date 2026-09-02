/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/unbound-method */
import { describe, it, expect, vi } from "vitest";
import {
    getSuggestedIndexes,
    getDropIndexSuggestions,
    getSchemaAdvice,
    getSlowQueries,
} from "./performanceAdvisorUtils.js";
import type { ApiClient } from "@mongodb-js/mcp-atlas-api-client";

const context = { headers: { "x-request-id": "req-pa-1" } };

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
    it("getSuggestedIndexes logs a debug message with x-request-id on failure", async () => {
        const apiClient = makeApiClient({});
        const { debug } = apiClient.logger;
        await expect(getSuggestedIndexes(apiClient, "proj1", "cluster1", context)).rejects.toThrow();
        expect(debug).toHaveBeenCalledWith(
            expect.objectContaining({
                message: expect.stringContaining("Failed to list suggested indexes"),
                attributes: expect.objectContaining({ "x-request-id": "req-pa-1" }),
            })
        );
    });

    it("getDropIndexSuggestions logs a debug message with x-request-id on failure", async () => {
        const apiClient = makeApiClient({});
        const { debug } = apiClient.logger;
        await expect(getDropIndexSuggestions(apiClient, "proj1", "cluster1", context)).rejects.toThrow();
        expect(debug).toHaveBeenCalledWith(
            expect.objectContaining({
                message: expect.stringContaining("Failed to list drop index suggestions"),
                attributes: expect.objectContaining({ "x-request-id": "req-pa-1" }),
            })
        );
    });

    it("getSchemaAdvice logs a debug message with x-request-id on failure", async () => {
        const apiClient = makeApiClient({});
        const { debug } = apiClient.logger;
        await expect(getSchemaAdvice(apiClient, "proj1", "cluster1", context)).rejects.toThrow();
        expect(debug).toHaveBeenCalledWith(
            expect.objectContaining({
                message: expect.stringContaining("Failed to list schema advice"),
                attributes: expect.objectContaining({ "x-request-id": "req-pa-1" }),
            })
        );
    });

    it("getSlowQueries logs a debug message with x-request-id on failure", async () => {
        // getProcessIdsFromCluster calls getCluster then getFlexCluster; when both fail the catch
        // block in getSlowQueries fires and logs.
        const apiClient = makeApiClient({});
        const { debug } = apiClient.logger;
        await expect(getSlowQueries(apiClient, "proj1", "cluster1", undefined, undefined, context)).rejects.toThrow();
        expect(debug).toHaveBeenCalledWith(
            expect.objectContaining({
                message: expect.stringContaining("Failed to list slow query logs"),
                attributes: expect.objectContaining({ "x-request-id": "req-pa-1" }),
            })
        );
    });
});
