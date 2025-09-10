import { describe, it, expect, vi } from "vitest";
import type { FindCursor } from "mongodb";
import { calculateObjectSize } from "bson";
import { iterateCursorUntilMaxBytes } from "../../../src/helpers/iterateCursor.js";

describe("iterateCursorUntilMaxBytes", () => {
    function createMockCursor(
        docs: unknown[],
        { abortController, abortOnIdx }: { abortController?: AbortController; abortOnIdx?: number } = {}
    ): FindCursor<unknown> {
        let idx = 0;
        return {
            tryNext: vi.fn(() => {
                if (idx === abortOnIdx) {
                    abortController?.abort();
                }

                if (idx < docs.length) {
                    return Promise.resolve(docs[idx++]);
                }
                return Promise.resolve(null);
            }),
            toArray: vi.fn(() => {
                return Promise.resolve(docs);
            }),
        } as unknown as FindCursor<unknown>;
    }

    it("returns all docs if maxBytesPerQuery is -1", async () => {
        const docs = Array.from({ length: 1000 }).map((_, idx) => ({ value: idx }));
        const cursor = createMockCursor(docs);
        const maxBytes = -1;
        const result = await iterateCursorUntilMaxBytes({ cursor, maxBytesPerQuery: maxBytes });
        expect(result).toEqual(docs);
    });

    it("returns all docs if maxBytesPerQuery is 0", async () => {
        const docs = Array.from({ length: 1000 }).map((_, idx) => ({ value: idx }));
        const cursor = createMockCursor(docs);
        const maxBytes = 0;
        const result = await iterateCursorUntilMaxBytes({ cursor, maxBytesPerQuery: maxBytes });
        expect(result).toEqual(docs);
    });

    it("respects abort signal and breaks out of loop when aborted", async () => {
        const docs = Array.from({ length: 20 }).map((_, idx) => ({ value: idx }));
        const abortController = new AbortController();
        const cursor = createMockCursor(docs, { abortOnIdx: 9, abortController });
        const maxBytes = 10000;
        const result = await iterateCursorUntilMaxBytes({
            cursor,
            maxBytesPerQuery: maxBytes,
            abortSignal: abortController.signal,
        });
        expect(result).toEqual(Array.from({ length: 10 }).map((_, idx) => ({ value: idx })));
    });

    it("returns all docs if under maxBytesPerQuery", async () => {
        const docs = [{ a: 1 }, { b: 2 }];
        const cursor = createMockCursor(docs);
        const maxBytes = 10000;
        const result = await iterateCursorUntilMaxBytes({ cursor, maxBytesPerQuery: maxBytes });
        expect(result).toEqual(docs);
    });

    it("returns only docs that fit under maxBytesPerQuery", async () => {
        const doc1 = { a: "x".repeat(100) };
        const doc2 = { b: "y".repeat(1000) };
        const docs = [doc1, doc2];
        const cursor = createMockCursor(docs);
        const maxBytes = calculateObjectSize(doc1) + 10;
        const result = await iterateCursorUntilMaxBytes({ cursor, maxBytesPerQuery: maxBytes });
        expect(result).toEqual([doc1]);
    });

    it("returns empty array if maxBytesPerQuery is smaller than even the first doc", async () => {
        const docs = [{ a: "x".repeat(100) }];
        const cursor = createMockCursor(docs);
        const result = await iterateCursorUntilMaxBytes({ cursor, maxBytesPerQuery: 10 });
        expect(result).toEqual([]);
    });

    it("handles empty cursor", async () => {
        const cursor = createMockCursor([]);
        const result = await iterateCursorUntilMaxBytes({ cursor, maxBytesPerQuery: 1000 });
        expect(result).toEqual([]);
    });

    it("does not include a doc that would overflow the max bytes allowed", async () => {
        const doc1 = { a: "x".repeat(10) };
        const doc2 = { b: "y".repeat(1000) };
        const docs = [doc1, doc2];
        const cursor = createMockCursor(docs);
        // Set maxBytes so that after doc1, biggestDocSizeSoFar would prevent fetching doc2
        const maxBytes = calculateObjectSize(doc1) + calculateObjectSize(doc2) - 1;
        const result = await iterateCursorUntilMaxBytes({ cursor, maxBytesPerQuery: maxBytes });
        // Should only include doc1, not doc2
        expect(result).toEqual([doc1]);
    });
});
