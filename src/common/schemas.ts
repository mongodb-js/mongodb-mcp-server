export const previewFeatureValues = ["mcpUI"] as const;
export type PreviewFeature = (typeof previewFeatureValues)[number];
