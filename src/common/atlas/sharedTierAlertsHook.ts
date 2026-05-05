import type { ApiClient } from "./apiClient.js";
import type { LoggerBase } from "../logging/loggerBase.js";
import { LogId } from "../logging/index.js";

type AlertResult = Awaited<ReturnType<ApiClient["listAlerts"]>>["results"][number];

const SHARED_TIER_EVENT_TYPES = new Set<string>(["OUTSIDE_METRIC_THRESHOLD", "OUTSIDE_FLEX_METRIC_THRESHOLD"]);

const SHARED_TIER_METRICS = new Set<string>([
    "CONNECTIONS_PERCENT",
    "FLEX_CONNECTIONS_PERCENT",
    "FLEX_DATA_SIZE_TOTAL",
    "LOGICAL_SIZE",
]);

/** One page of OPEN alerts (same defaults as atlas-list-alerts); sufficient for shared-tier MVP. */
const LIST_ALERTS_PAGE_SIZE = 100;

export interface RunSharedTierAlertsHookParams {
    projectId: string;
    clusterName: string;
    instanceType: "FREE" | "FLEX" | "DEDICATED";
    apiClient: ApiClient;
    logger: LoggerBase;
}

interface SharedTierAlertItem {
    id: string;
    eventTypeName: string;
    metricName: string;
    clusterName: string;
    status: string;
    created?: string;
    updated?: string;
}

function isSharedTierInstanceType(t: "FREE" | "FLEX" | "DEDICATED" | undefined): t is "FREE" | "FLEX" {
    return t === "FREE" || t === "FLEX";
}

function matchesFilters(
    alert: AlertResult,
    clusterName: string
): { eventTypeName: string; metricName: string } | undefined {
    const eventTypeName = String(alert.eventTypeName);
    const metricName = "metricName" in alert ? alert.metricName : undefined;
    const alertCluster = "clusterName" in alert ? alert.clusterName : undefined;
    if (!metricName || alertCluster !== clusterName) return undefined;
    if (!SHARED_TIER_EVENT_TYPES.has(eventTypeName) || !SHARED_TIER_METRICS.has(metricName)) return undefined;
    return { eventTypeName, metricName };
}

function toMatched(
    alert: AlertResult,
    eventTypeName: string,
    metricName: string,
    clusterName: string
): SharedTierAlertItem {
    return {
        id: alert.id,
        eventTypeName,
        metricName,
        clusterName,
        status: alert.status,
        ...(alert.created !== undefined ? { created: alert.created } : {}),
        ...(alert.updated !== undefined ? { updated: alert.updated } : {}),
    };
}

function buildRecommendationParagraph(clusterName: string, tier: "Free" | "Flex", metricNames: string[]): string {
    const unique = [...new Set(metricNames)].sort();
    const metricsList = unique.join(", ");
    return (
        `Note: Atlas reports open shared-tier threshold alerts for cluster "${clusterName}" affecting: ${metricsList}. ` +
        `You may be near connection or storage limits on this ${tier} tier deployment. ` +
        `Consider upgrading to a paid tier for more headroom — use the atlas-upgrade-cluster tool to upgrade "${clusterName}".`
    );
}

/**
 * Post-connect: inspect tier; for Free/Flex only, fetch OPEN alerts and return upgrade guidance when filters match.
 * Returns tier, JSON-serialized alerts, and recommendation text for the caller to surface and attach to telemetry.
 */
export async function runSharedTierAlertsHook(
    params: RunSharedTierAlertsHookParams
): Promise<{ recommendationText: string; tier: "Free" | "Flex"; alerts: string[] } | null> {
    const { projectId, clusterName, instanceType, apiClient, logger } = params;

    if (!isSharedTierInstanceType(instanceType)) {
        return null;
    }

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

    const collectedById = new Map<string, SharedTierAlertItem>();
    for (const alert of results) {
        const matched = matchesFilters(alert, clusterName);
        if (!matched) {
            continue;
        }
        const row = toMatched(alert, matched.eventTypeName, matched.metricName, clusterName);
        collectedById.set(row.id, row);
    }

    const collected = [...collectedById.values()];
    if (collected.length === 0) {
        return null;
    }

    const tier = instanceType === "FREE" ? "Free" : "Flex";
    const alerts = collected.map((item) => JSON.stringify(item));

    return {
        recommendationText: buildRecommendationParagraph(
            clusterName,
            tier,
            collected.map((a) => a.metricName)
        ),
        tier,
        alerts,
    };
}
