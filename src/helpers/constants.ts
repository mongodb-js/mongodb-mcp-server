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
