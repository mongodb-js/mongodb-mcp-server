import { z } from "zod";
import type { ApiClient } from "./apiClient.js";
import type { LoggerBase } from "../logging/loggerBase.js";
import { LogId } from "../logging/index.js";
import { SHARED_TIER_METRIC_NAMES } from "../../telemetry/types.js";
import type { SharedTierMetricName, SharedTierTier } from "../../telemetry/types.js";

/** One page of OPEN alerts (same defaults as atlas-list-alerts); sufficient for shared-tier MVP. */
const LIST_ALERTS_PAGE_SIZE = 100;

const SharedTierAlertSchema = z.object({
    id: z.string(),
    eventTypeName: z.enum(["OUTSIDE_METRIC_THRESHOLD", "OUTSIDE_FLEX_METRIC_THRESHOLD"]),
    metricName: z.enum(SHARED_TIER_METRIC_NAMES),
    clusterName: z.string(),
    status: z.string(),
    created: z.string().optional(),
    updated: z.string().optional(),
});

export interface RunSharedTierAlertsHookParams {
    projectId: string;
    clusterName: string;
    instanceType: "FREE" | "FLEX" | "DEDICATED";
    apiClient: ApiClient;
    logger: LoggerBase;
}

function isSharedTierInstanceType(t: "FREE" | "FLEX" | "DEDICATED" | undefined): t is "FREE" | "FLEX" {
    return t === "FREE" || t === "FLEX";
}

function buildRecommendationParagraph(
    clusterName: string,
    tier: SharedTierTier,
    metricNames: SharedTierMetricName[]
): string {
    const metricsList = [...metricNames].sort().join(", ");
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
): Promise<{ recommendationText: string; tier: SharedTierTier; alerts: SharedTierMetricName[] } | undefined> {
    const { projectId, clusterName, instanceType, apiClient, logger } = params;

    if (!isSharedTierInstanceType(instanceType)) {
        return undefined;
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
        return undefined;
    }

    const alerts = [
        ...new Set(
            (data?.results ?? []).flatMap((alert) => {
                const parsed = SharedTierAlertSchema.safeParse(alert);
                return parsed.success && parsed.data.clusterName === clusterName ? [parsed.data.metricName] : [];
            })
        ),
    ];

    if (!alerts.length) {
        return undefined;
    }

    const tier = instanceType === "FREE" ? "Free" : "Flex";

    return {
        recommendationText: buildRecommendationParagraph(clusterName, tier, alerts),
        tier,
        alerts,
    };
}
