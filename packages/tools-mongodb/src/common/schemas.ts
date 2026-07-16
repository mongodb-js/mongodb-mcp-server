const PREVIEW_FEATURE_VALUES = Object.freeze(["mcpUI"] as const);
export const previewFeatureValues = PREVIEW_FEATURE_VALUES;
export type PreviewFeature = (typeof previewFeatureValues)[number];

const MONITORING_SERVER_FEATURE_VALUES = Object.freeze(["health-check", "metrics"] as const);
export const monitoringServerFeatureValues = MONITORING_SERVER_FEATURE_VALUES;
export type MonitoringServerFeature = (typeof monitoringServerFeatureValues)[number];
