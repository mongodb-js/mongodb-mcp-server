export const previewFeatureValues = ["search", "mcpUI", "setup"] as const;
export type PreviewFeature = (typeof previewFeatureValues)[number];

export const similarityValues = ["cosine", "euclidean", "dotProduct"] as const;

export type Similarity = (typeof similarityValues)[number];
