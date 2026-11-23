export const previewFeatureValues = ["mcpUI"] as const;
export type PreviewFeature = (typeof previewFeatureValues)[number];

export const monitoringServerFeatureValues = ["health-check", "metrics", "process-metrics"] as const;
export type MonitoringServerFeature = (typeof monitoringServerFeatureValues)[number];
