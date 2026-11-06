import { TOOL_EXECUTION_DURATION_LABEL_NAMES } from "@mongodb-js/mcp-types";

/**
 * Label names the default definitions set per observation. An instance label
 * must not use one: the observation-level value always wins.
 */
export const RESERVED_METRIC_LABEL_NAMES = [...TOOL_EXECUTION_DURATION_LABEL_NAMES, "reason"] as const;

/** A label name reserved for per-observation use. */
export type ReservedMetricLabelName = (typeof RESERVED_METRIC_LABEL_NAMES)[number];
