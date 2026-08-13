import {
    AGG_COUNT_MAX_TIME_MS_CAP as AGG_COUNT_MAX_TIME_MS_CAP_VALUE,
    QUERY_COUNT_MAX_TIME_MS_CAP as QUERY_COUNT_MAX_TIME_MS_CAP_VALUE,
    ONE_MB as ONE_MB_VALUE,
    CURSOR_LIMITS_TO_LLM_TEXT as CURSOR_LIMITS_TO_LLM_TEXT_VALUE,
} from "@mongodb-js/mcp-tools-mongodb";

/**
 * Local, mutable mirrors of the constants exported by
 * `@mongodb-js/mcp-tools-mongodb`. Vitest only allows `vi.spyOn(module, "x", "get")`
 * on namespaces it transforms itself; re-exporting through the package barrel
 * would produce a frozen namespace that cannot be spied on. Tests that need to
 * override a constant (e.g. the maxTimeMS caps) import * as constants from here.
 */
export const AGG_COUNT_MAX_TIME_MS_CAP: number = AGG_COUNT_MAX_TIME_MS_CAP_VALUE;
export const QUERY_COUNT_MAX_TIME_MS_CAP: number = QUERY_COUNT_MAX_TIME_MS_CAP_VALUE;
export const ONE_MB: number = ONE_MB_VALUE;
export const CURSOR_LIMITS_TO_LLM_TEXT = CURSOR_LIMITS_TO_LLM_TEXT_VALUE;

export type { CursorLimitKey } from "@mongodb-js/mcp-tools-mongodb";
