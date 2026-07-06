import { z } from "zod";

/**
 * A cap for the maxTimeMS used for FindCursor.countDocuments when config.queryCountMaxTimeMsCap is unset.
 *
 * The number is relatively smaller because we expect the count documents query
 * to be finished sooner if not by the time the batch of documents is retrieved
 * so that count documents query don't hold the final response back.
 */
export const QUERY_COUNT_MAX_TIME_MS_CAP: number = 10_000;

/**
 * A cap for the maxTimeMS used for counting resulting documents of an
 * aggregation when config.aggregationCountMaxTimeMsCap is unset.
 */
export const AGG_COUNT_MAX_TIME_MS_CAP: number = 60_000;

export const ONE_MB: number = 1 * 1024 * 1024;

export const CURSOR_LIMIT_KEYS = z.enum([
    "config.maxDocumentsPerQuery",
    "config.maxBytesPerQuery",
    "tool.responseBytesLimit",
]);
export type CursorLimitKey = z.infer<typeof CURSOR_LIMIT_KEYS>;

/**
 * A map of applied limit on cursors to a text that is supposed to be sent as
 * response to LLM
 */
export const CURSOR_LIMITS_TO_LLM_TEXT = {
    "config.maxDocumentsPerQuery": "server's configured - maxDocumentsPerQuery",
    "config.maxBytesPerQuery": "server's configured - maxBytesPerQuery",
    "tool.responseBytesLimit": "tool's parameter - responseBytesLimit",
} as const satisfies Record<CursorLimitKey, string>;
