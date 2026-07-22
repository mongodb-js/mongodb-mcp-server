import { z } from "zod";

/**
 * A cap for the maxTimeMS used for FindCursor.countDocuments.
 *
 * The number is relatively smaller because we expect the count documents query
 * to be finished sooner if not by the time the batch of documents is retrieved
 * so that count documents query don't hold the final response back.
 */
export const QUERY_COUNT_MAX_TIME_MS_CAP: number = 10_000;

/**
 * A cap for the maxTimeMS used for counting resulting documents of an
 * aggregation.
 */
export const AGG_COUNT_MAX_TIME_MS_CAP: number = 60_000;

export const ONE_MB: number = 1 * 1024 * 1024;

/**
 * The name of the `export` tool. Defined here (rather than referenced from the
 * `ExportTool` class) so tools such as `find`/`aggregate` can check for the
 * export tool's availability without importing `ExportTool`, which would create
 * a circular import (`export.ts` imports `MongoDBToolBase`, `FindArgs` and
 * `AggregateArgs`).
 */
export const EXPORT_TOOL_NAME = "export";

export const CURSOR_LIMIT_KEYS = z.enum([
    "config.maxDocumentsPerQuery",
    "config.maxBytesPerQuery",
    "tool.responseBytesLimit",
]);
export type CursorLimitKey = z.infer<typeof CURSOR_LIMIT_KEYS>;

/**
 * A map of applied limit on cursors to a human-readable description that is
 * returned to the model.
 */
export const CURSOR_LIMITS_TO_LLM_TEXT = {
    "config.maxDocumentsPerQuery": "the server's configured maximum number of documents",
    "config.maxBytesPerQuery": "the server's configured maximum response size",
    "tool.responseBytesLimit": "the responseBytesLimit parameter",
} as const satisfies Record<CursorLimitKey, string>;
