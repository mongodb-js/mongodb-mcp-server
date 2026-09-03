import { describe, it, expect, vi } from "vitest";
import { formatCluster, formatFlexCluster, inspectCluster } from "../../../src/common/atlas/cluster.js";
import type { ApiClient } from "../../../src/common/atlas/apiClient.js";
import type { ClusterDescription20240805, FlexClusterDescription20241113 } from "../../../src/common/atlas/openapi.js";

// The generated API types mark nearly every field required; cast so fixtures
// only carry what the formatters read.
const dedicatedClusterDescription = {
    id: "dedicated-cluster-id",
    name: "dedicated-cluster",
    stateName: "IDLE",
    mongoDBVersion: "8.0",
    connectionStrings: { standard: "mongodb://host-00:27017,host-01:27017" },
    replicationSpecs: [
        {
            regionConfigs: [{ providerName: "AWS", regionName: "US_EAST_1", electableSpecs: { instanceSize: "M10" } }],
        },
    ],
} as ClusterDescription20240805;

const flexClusterDescription = {
    id: "flex-cluster-id",
    name: "flex-cluster",
    stateName: "IDLE",
    mongoDBVersion: "8.0",
    connectionStrings: { standard: "mongodb://flex-host:27017" },
    providerSettings: { backingProviderName: "AWS", regionName: "US_EAST_1" },
} as FlexClusterDescription20241113;

describe("formatCluster", () => {
    it("maps the Atlas cluster id to clusterId", () => {
        const cluster = formatCluster(dedicatedClusterDescription);

        expect(cluster).toMatchObject({
            name: "dedicated-cluster",
            clusterId: "dedicated-cluster-id",
            instanceType: "DEDICATED",
            instanceSize: "M10",
        });
    });

    it("leaves clusterId undefined when the Atlas API omits the id", () => {
        const { id: _id, ...withoutId } = dedicatedClusterDescription;
        void _id;

        expect(formatCluster(withoutId).clusterId).toBeUndefined();
    });
});

describe("formatFlexCluster", () => {
    it("maps the Atlas cluster id to clusterId", () => {
        const cluster = formatFlexCluster(flexClusterDescription);

        expect(cluster).toMatchObject({
            name: "flex-cluster",
            clusterId: "flex-cluster-id",
            instanceType: "FLEX",
        });
    });

    it("leaves clusterId undefined when the Atlas API omits the id", () => {
        const { id: _id, ...withoutId } = flexClusterDescription;
        void _id;

        expect(formatFlexCluster(withoutId).clusterId).toBeUndefined();
    });
});

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
