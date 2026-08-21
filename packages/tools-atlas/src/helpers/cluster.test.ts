import { describe, it, expect, vi } from "vitest";
import { inspectCluster } from "../../../src/common/atlas/cluster.js";
import type { ApiClient } from "../../../src/common/atlas/apiClient.js";

describe("inspectCluster", () => {
    it("includes x-request-id in error log when both getCluster and getFlexCluster fail", async () => {
        const debug = vi.fn();
        const error = vi.fn();

        const apiClient = {
            getCluster: vi.fn().mockRejectedValue(new Error("cluster not found")),
            getFlexCluster: vi.fn().mockRejectedValue(new Error("flex cluster not found")),
            logger: { debug, error },
        } as unknown as ApiClient;

        const context = { requestInfo: { headers: { "x-request-id": "req-cluster-1" } } };

        await expect(inspectCluster(apiClient, "proj1", "cluster1", context)).rejects.toThrow();

        expect(error).toHaveBeenCalledWith(
            expect.objectContaining({
                // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
                attributes: expect.objectContaining({ "x-request-id": "req-cluster-1" }),
            })
        );
    });
});
