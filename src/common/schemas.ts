export const previewFeatureValues = ["search", "mcpUI", "setup"] as const;
export type PreviewFeature = (typeof previewFeatureValues)[number];

export const monitoringServerFeatureValues = ["health-check", "metrics"] as const;
export type MonitoringServerFeature = (typeof monitoringServerFeatureValues)[number];
