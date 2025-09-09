import { calculateObjectSize } from "bson";
import type { AggregationCursor, FindCursor } from "mongodb";

/**
 * This function attempts to put a guard rail against accidental memory over
 * flow on the MCP server.
 *
 * The cursor is iterated until we can predict that fetching next doc won't
 * exceed the maxBytesPerQuery limit.
 */
export async function iterateCursorUntilMaxBytes(
    cursor: FindCursor<unknown> | AggregationCursor<unknown>,
    maxBytesPerQuery: number
): Promise<unknown[]> {
    let biggestDocSizeSoFar = 0;
    let totalBytes = 0;
    const bufferedDocuments: unknown[] = [];
    while (true) {
        if (totalBytes + biggestDocSizeSoFar >= maxBytesPerQuery) {
            break;
        }

        const nextDocument = await cursor.tryNext();
        if (!nextDocument) {
            break;
        }

        const nextDocumentSize = calculateObjectSize(nextDocument);
        if (totalBytes + nextDocumentSize >= maxBytesPerQuery) {
            break;
        }

        totalBytes += nextDocumentSize;
        biggestDocSizeSoFar = Math.max(biggestDocSizeSoFar, nextDocumentSize);
        bufferedDocuments.push(nextDocument);
    }

    return bufferedDocuments;
}
