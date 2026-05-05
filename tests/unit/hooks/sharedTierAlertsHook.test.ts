import { describe, it, expect, vi, beforeEach } from "vitest";
import type { MockedFunction } from "vitest";
import { runSharedTierAlertsHook } from "../../../src/common/atlas/sharedTierAlertsHook.js";
import type { ApiClient } from "../../../src/common/atlas/apiClient.js";
import type { LoggerBase } from "../../../src/common/logging/loggerBase.js";
import { LogId } from "../../../src/common/logging/index.js";
import type { LogPayload } from "../../../src/common/logging/loggingTypes.js";

type ListAlertsResult = Awaited<ReturnType<ApiClient["listAlerts"]>>;

describe("runSharedTierAlertsHook", () => {
    let listAlerts: MockedFunction<ApiClient["listAlerts"]>;
    let warning: MockedFunction<(payload: LogPayload) => void>;
    let logger: LoggerBase;

    const baseParams: {
        projectId: string;
        clusterName: string;
        instanceType: "FREE" | "FLEX" | "DEDICATED";
        apiClient: ApiClient;
        logger: LoggerBase;
    } = {
        projectId: "group-1",
        clusterName: "my-cluster",
        instanceType: "DEDICATED",
        apiClient: {} as ApiClient,
        logger: {} as LoggerBase,
    };

    beforeEach(() => {
        listAlerts = vi.fn() as MockedFunction<ApiClient["listAlerts"]>;
        warning = vi.fn() as MockedFunction<(payload: LogPayload) => void>;
        logger = {
            warning,
        } as unknown as LoggerBase;
        baseParams.apiClient = { listAlerts } as unknown as ApiClient;
        baseParams.logger = logger;
    });

    it("returns null and does not call listAlerts for dedicated tier", async () => {
        const result = await runSharedTierAlertsHook({
            ...baseParams,
            instanceType: "DEDICATED",
        });
        expect(result).toBeNull();
        expect(listAlerts).not.toHaveBeenCalled();
    });

    it("filters alerts by event type, metric, and cluster name", async () => {
        listAlerts.mockResolvedValue({
            results: [
                {
                    id: "a1",
                    status: "OPEN",
                    eventTypeName: "OUTSIDE_METRIC_THRESHOLD",
                    metricName: "CONNECTIONS_PERCENT",
                    clusterName: "my-cluster",
                    created: "2025-01-01T00:00:00Z",
                },
                {
                    id: "a2",
                    status: "OPEN",
                    eventTypeName: "HOST_DOWN",
                    metricName: "CONNECTIONS_PERCENT",
                    clusterName: "my-cluster",
                },
                {
                    id: "a3",
                    status: "OPEN",
                    eventTypeName: "OUTSIDE_METRIC_THRESHOLD",
                    metricName: "CONNECTIONS_PERCENT",
                    clusterName: "other-cluster",
                },
                {
                    id: "a4",
                    status: "OPEN",
                    eventTypeName: "OUTSIDE_FLEX_METRIC_THRESHOLD",
                    metricName: "FLEX_DATA_SIZE_TOTAL",
                    clusterName: "my-cluster",
                },
            ],
            totalCount: 4,
        } as unknown as ListAlertsResult);

        const result = await runSharedTierAlertsHook({
            ...baseParams,
            instanceType: "FLEX",
        });

        expect(result).not.toBeNull();
        expect(result!.recommendationText).toContain("CONNECTIONS_PERCENT");
        expect(result!.recommendationText).toContain("FLEX_DATA_SIZE_TOTAL");
        expect(result!.tier).toBe("Flex");
        expect(Array.isArray(result!.alerts)).toBe(true);
        const parsedAlerts = result!.alerts.map((s) => JSON.parse(s) as { id: string });
        expect(parsedAlerts.map((a) => a.id).sort()).toEqual(["a1", "a4"]);
    });

    it("returns null when no alerts match", async () => {
        listAlerts.mockResolvedValue({
            results: [
                {
                    id: "a1",
                    status: "OPEN",
                    eventTypeName: "HOST_DOWN",
                    metricName: "CONNECTIONS_PERCENT",
                    clusterName: "my-cluster",
                },
            ],
            totalCount: 1,
        } as unknown as ListAlertsResult);

        const result = await runSharedTierAlertsHook({
            ...baseParams,
            instanceType: "FREE",
        });

        expect(result).toBeNull();
    });

    it("logs a warning and returns null when listAlerts rejects", async () => {
        listAlerts.mockRejectedValue(new Error("network down"));

        const result = await runSharedTierAlertsHook({
            ...baseParams,
            instanceType: "FREE",
        });

        expect(result).toBeNull();
        expect(warning).toHaveBeenCalledTimes(1);
        const listAlertsFailPayload = warning.mock.calls[0]?.[0];
        expect(listAlertsFailPayload?.id).toBe(LogId.atlasSharedTierAlertsHookWarning);
        expect(listAlertsFailPayload?.context).toBe("shared-tier-alerts-hook");
        expect(listAlertsFailPayload?.message).toContain("network down");
    });

    it("matches LOGICAL_SIZE among mixed OPEN alerts on one page", async () => {
        listAlerts.mockResolvedValue({
            results: [
                {
                    id: "n1",
                    status: "OPEN",
                    eventTypeName: "HOST_DOWN",
                    clusterName: "my-cluster",
                },
                {
                    id: "hit",
                    status: "OPEN",
                    eventTypeName: "OUTSIDE_METRIC_THRESHOLD",
                    metricName: "LOGICAL_SIZE",
                    clusterName: "my-cluster",
                },
            ],
        } as unknown as ListAlertsResult);

        const result = await runSharedTierAlertsHook({
            ...baseParams,
            instanceType: "FREE",
        });

        expect(listAlerts).toHaveBeenCalledTimes(1);
        expect(result).not.toBeNull();
        expect(result!.recommendationText).toContain("LOGICAL_SIZE");
        expect(result!.tier).toBe("Free");
        const parsedAlerts = result!.alerts.map((s) => JSON.parse(s) as { id: string });
        expect(parsedAlerts[0]?.id).toBe("hit");
    });
});
