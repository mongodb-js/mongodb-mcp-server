import { describe, it, expect, vi } from "vitest";
import { inspectCluster } from "./cluster.js";
import type { ApiClient } from "@mongodb-js/mcp-atlas-api-client";

describe("inspectCluster", () => {
    it("logs an error when both getCluster and getFlexCluster fail", async () => {
        const error = vi.fn();

        const apiClient = {
            getCluster: vi.fn().mockRejectedValue(new Error("cluster not found")),
            getFlexCluster: vi.fn().mockRejectedValue(new Error("flex cluster not found")),
            logger: { error },
        } as unknown as ApiClient;

        await expect(inspectCluster(apiClient, "proj1", "cluster1")).rejects.toThrow();

        expect(error).toHaveBeenCalledWith(
            expect.objectContaining({
                message: expect.stringContaining("error inspecting cluster"), // eslint-disable-line @typescript-eslint/no-unsafe-assignment
            })
        );
    });
});
