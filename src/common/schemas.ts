export const previewFeatureValues = ["search", "mcpUI"] as const;
export type PreviewFeature = (typeof previewFeatureValues)[number];
