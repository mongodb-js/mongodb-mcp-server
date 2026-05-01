import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { MockInstance, MockedFunction } from "vitest";
import * as clusterModule from "../../../src/common/atlas/cluster.js";
import type { Cluster } from "../../../src/common/atlas/cluster.js";
import { runSharedTierAlertsHook } from "../../../src/common/atlas/sharedTierAlertsHook.js";
import type { ApiClient } from "../../../src/common/atlas/apiClient.js";
import type { Telemetry } from "../../../src/telemetry/telemetry.js";
import type { LoggerBase } from "../../../src/common/logging/loggerBase.js";
import { LogId } from "../../../src/common/logging/index.js";
import type { LogPayload } from "../../../src/common/logging/loggingTypes.js";
import type { BaseEvent } from "../../../src/telemetry/types.js";

type ListAlertsResult = Awaited<ReturnType<ApiClient["listAlerts"]>>;

describe("runSharedTierAlertsHook", () => {
    let listAlerts: MockedFunction<ApiClient["listAlerts"]>;
    let emitEvents: MockedFunction<(events: BaseEvent[]) => void>;
    let warning: MockedFunction<(payload: LogPayload) => void>;
    let telemetry: Telemetry;
    let logger: LoggerBase;
    let inspectClusterSpy: MockInstance<typeof clusterModule.inspectCluster>;

    const baseParams: {
        projectId: string;
        clusterName: string;
        apiClient: ApiClient;
        telemetry: Telemetry;
        logger: LoggerBase;
    } = {
        projectId: "group-1",
        clusterName: "my-cluster",
        apiClient: {} as ApiClient,
        telemetry: {} as Telemetry,
        logger: {} as LoggerBase,
    };

    beforeEach(() => {
        listAlerts = vi.fn() as MockedFunction<ApiClient["listAlerts"]>;
        emitEvents = vi.fn() as MockedFunction<(events: BaseEvent[]) => void>;
        warning = vi.fn() as MockedFunction<(payload: LogPayload) => void>;
        telemetry = {
            isTelemetryEnabled: () => true,
            emitEvents,
        } as unknown as Telemetry;
        logger = {
            warning,
        } as unknown as LoggerBase;
        inspectClusterSpy = vi.spyOn(clusterModule, "inspectCluster") as MockInstance<
            typeof clusterModule.inspectCluster
        >;
        inspectClusterSpy.mockResolvedValue({ instanceType: "DEDICATED" } as Cluster);
        baseParams.apiClient = { listAlerts } as unknown as ApiClient;
        baseParams.telemetry = telemetry;
        baseParams.logger = logger;
    });

    afterEach(() => {
        inspectClusterSpy.mockRestore();
    });

    it("returns null and does not call listAlerts for dedicated tier", async () => {
        const result = await runSharedTierAlertsHook({
            ...baseParams,
        });
        expect(result).toBeNull();
        expect(listAlerts).not.toHaveBeenCalled();
        expect(emitEvents).not.toHaveBeenCalled();
    });

    it("returns null when inspectCluster fails", async () => {
        inspectClusterSpy.mockRejectedValue(new Error("not found"));

        const result = await runSharedTierAlertsHook({
            ...baseParams,
        });

        expect(result).toBeNull();
        expect(listAlerts).not.toHaveBeenCalled();
        expect(warning).toHaveBeenCalledTimes(1);
        const inspectFailPayload = warning.mock.calls[0]?.[0];
        expect(inspectFailPayload?.message).toContain("not found");
    });

    it("filters alerts by event type, metric, and cluster name", async () => {
        inspectClusterSpy.mockResolvedValue({ instanceType: "FLEX" } as Cluster);
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
        });

        expect(result).not.toBeNull();
        expect(result!.recommendationText).toContain("CONNECTIONS_PERCENT");
        expect(result!.recommendationText).toContain("FLEX_DATA_SIZE_TOTAL");
        expect(emitEvents).toHaveBeenCalledTimes(1);
        const firstBatch = emitEvents.mock.calls[0]?.[0];
        expect(firstBatch).toBeDefined();
        const event = firstBatch![0]!;
        const props = event.properties as Record<string, unknown>;
        expect(props.command).toBe("shared tier alerts");
        expect(props.Tier).toBe("Flex");
        const alerts = props.Alerts as { id: string }[];
        expect(Array.isArray(alerts)).toBe(true);
        expect(alerts.map((x) => x.id).sort()).toEqual(["a1", "a4"]);
    });

    it("returns null when no alerts match and does not emit telemetry", async () => {
        inspectClusterSpy.mockResolvedValue({ instanceType: "FREE" } as Cluster);
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
        });

        expect(result).toBeNull();
        expect(emitEvents).not.toHaveBeenCalled();
    });

    it("logs a warning and returns null when listAlerts rejects", async () => {
        inspectClusterSpy.mockResolvedValue({ instanceType: "FREE" } as Cluster);
        listAlerts.mockRejectedValue(new Error("network down"));

        const result = await runSharedTierAlertsHook({
            ...baseParams,
        });

        expect(result).toBeNull();
        expect(emitEvents).not.toHaveBeenCalled();
        expect(warning).toHaveBeenCalledTimes(1);
        const listAlertsFailPayload = warning.mock.calls[0]?.[0];
        expect(listAlertsFailPayload?.id).toBe(LogId.atlasSharedTierAlertsHookWarning);
        expect(listAlertsFailPayload?.context).toBe("shared-tier-alerts-hook");
        expect(listAlertsFailPayload?.message).toContain("network down");
    });

    it("matches LOGICAL_SIZE among mixed OPEN alerts on one page", async () => {
        inspectClusterSpy.mockResolvedValue({ instanceType: "FREE" } as Cluster);
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
        });

        expect(listAlerts).toHaveBeenCalledTimes(1);
        expect(result).not.toBeNull();
        expect(result!.recommendationText).toContain("LOGICAL_SIZE");
    });
});
