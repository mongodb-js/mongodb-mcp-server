import type { ApiClient } from "./apiClient.js";
import { inspectCluster } from "./cluster.js";
import type { LoggerBase } from "../logging/loggerBase.js";
import { LogId } from "../logging/index.js";
import type { Telemetry } from "../../telemetry/telemetry.js";
import type { BaseEvent } from "../../telemetry/types.js";

const SHARED_TIER_EVENT_TYPES = new Set<string>(["OUTSIDE_METRIC_THRESHOLD", "OUTSIDE_FLEX_METRIC_THRESHOLD"]);

const SHARED_TIER_METRICS = new Set<string>([
    "CONNECTIONS_PERCENT",
    "FLEX_CONNECTIONS_PERCENT",
    "FLEX_DATA_SIZE_TOTAL",
    "LOGICAL_SIZE",
]);

/** One page of OPEN alerts (same defaults as atlas-list-alerts); sufficient for shared-tier MVP. */
const LIST_ALERTS_PAGE_SIZE = 100;

/** Alert objects included on the MongoDB MCP telemetry event (`Alerts` property). */
export interface SharedTierAlertsTelemetryItem {
    id: string;
    eventTypeName: string;
    metricName: string;
    clusterName: string;
    status: string;
    created?: string;
    updated?: string;
}

export interface RunSharedTierAlertsHookParams {
    projectId: string;
    clusterName: string;
    apiClient: ApiClient;
    telemetry: Telemetry;
    logger: LoggerBase;
}

function asRecord(alert: unknown): Record<string, unknown> {
    return typeof alert === "object" && alert !== null ? (alert as Record<string, unknown>) : {};
}

function readString(r: Record<string, unknown>, key: string): string | undefined {
    const v = r[key];
    return typeof v === "string" ? v : undefined;
}

function isSharedTierInstanceType(t: "FREE" | "FLEX" | "DEDICATED" | undefined): t is "FREE" | "FLEX" {
    return t === "FREE" || t === "FLEX";
}

function matchesFilters(
    alert: Record<string, unknown>,
    clusterName: string
): { eventTypeName: string; metricName: string } | undefined {
    const eventTypeName = readString(alert, "eventTypeName");
    const metricName = readString(alert, "metricName");
    const alertCluster = readString(alert, "clusterName");
    if (!eventTypeName || !metricName || alertCluster !== clusterName) {
        return undefined;
    }
    if (!SHARED_TIER_EVENT_TYPES.has(eventTypeName) || !SHARED_TIER_METRICS.has(metricName)) {
        return undefined;
    }
    return { eventTypeName, metricName };
}

function toMatched(
    alert: Record<string, unknown>,
    eventTypeName: string,
    metricName: string
): SharedTierAlertsTelemetryItem | undefined {
    const id = readString(alert, "id");
    const clusterName = readString(alert, "clusterName");
    const status = readString(alert, "status");
    if (!id || !clusterName || !status) {
        return undefined;
    }
    const created = readString(alert, "created");
    const updated = readString(alert, "updated");
    return {
        id,
        eventTypeName,
        metricName,
        clusterName,
        status,
        ...(created !== undefined ? { created } : {}),
        ...(updated !== undefined ? { updated } : {}),
    };
}

function telemetryTier(instanceType: "FREE" | "FLEX"): "Free" | "Flex" {
    return instanceType === "FREE" ? "Free" : "Flex";
}

function buildRecommendationParagraph(clusterName: string, metricNames: string[]): string {
    const unique = [...new Set(metricNames)].sort();
    const metricsList = unique.join(", ");
    return (
        `Note: Atlas reports open shared-tier threshold alerts for cluster "${clusterName}" affecting: ${metricsList}. ` +
        `You may be near connection or storage limits on this Free/Flex deployment. ` +
        `Consider upgrading capacity (for example moving to Flex or a paid tier such as M10 or larger) if you need more headroom.`
    );
}

/**
 * Post-connect: inspect tier; for Free/Flex only, fetch OPEN alerts and return upgrade guidance when TD filters match.
 * Emits telemetry when any alerts match. Dedicated clusters: one inspectCluster then return null (no listAlerts).
 */
export async function runSharedTierAlertsHook(
    params: RunSharedTierAlertsHookParams
): Promise<{ recommendationText: string } | null> {
    const { projectId, clusterName, apiClient, telemetry, logger } = params;

    let instanceType: "FREE" | "FLEX" | "DEDICATED" | undefined;
    try {
        const cluster = await inspectCluster(apiClient, projectId, clusterName);
        instanceType = cluster.instanceType;
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        logger.warning({
            id: LogId.atlasSharedTierAlertsHookWarning,
            context: "shared-tier-alerts-hook",
            message: `Failed to inspect cluster for shared-tier hook: ${message}`,
        });
        return null;
    }

    if (!isSharedTierInstanceType(instanceType)) {
        return null;
    }

    const started = Date.now();
    let data;
    try {
        data = await apiClient.listAlerts({
            params: {
                path: { groupId: projectId },
                query: {
                    status: "OPEN",
                    itemsPerPage: LIST_ALERTS_PAGE_SIZE,
                    pageNum: 1,
                    includeCount: true,
                },
            },
        });
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        logger.warning({
            id: LogId.atlasSharedTierAlertsHookWarning,
            context: "shared-tier-alerts-hook",
            message: `Failed to list Atlas alerts for shared-tier hook: ${message}`,
        });
        return null;
    }

    const results = data?.results;
    if (!results?.length) {
        return null;
    }

    const collectedById = new Map<string, SharedTierAlertsTelemetryItem>();
    for (const raw of results) {
        const alert = asRecord(raw);
        const matched = matchesFilters(alert, clusterName);
        if (!matched) {
            continue;
        }
        const row = toMatched(alert, matched.eventTypeName, matched.metricName);
        if (row) {
            collectedById.set(row.id, row);
        }
    }

    const collected = [...collectedById.values()];
    if (collected.length === 0) {
        return null;
    }

    const Alerts: SharedTierAlertsTelemetryItem[] = collected.map(
        ({ id, eventTypeName, metricName, clusterName: cn, status, created, updated }) => ({
            id,
            eventTypeName,
            metricName,
            clusterName: cn,
            status,
            ...(created !== undefined ? { created } : {}),
            ...(updated !== undefined ? { updated } : {}),
        })
    );

    const tier = telemetryTier(instanceType);
    // `Alerts` is an array of objects (per MCP telemetry spec); `TelemetryEvent` index signature is primitives-only.
    const event = {
        timestamp: new Date().toISOString(),
        source: "mdbmcp" as const,
        properties: {
            command: "shared tier alerts",
            category: "atlas",
            component: "tool",
            duration_ms: Math.max(0, Date.now() - started),
            result: "success" as const,
            Tier: tier,
            Alerts,
            project_id: projectId,
            cluster_name: clusterName,
        },
    } as unknown as BaseEvent;
    telemetry.emitEvents([event]);

    return {
        recommendationText: buildRecommendationParagraph(
            clusterName,
            collected.map((a) => a.metricName)
        ),
    };
}
