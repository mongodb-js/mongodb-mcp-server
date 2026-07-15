import { describe, it, expect, vi } from "vitest";
import type { FindCursor } from "mongodb";
import { calculateObjectSize } from "bson";
import { collectCursorUntilMaxBytesLimit } from "../../../src/helpers/collectCursorUntilMaxBytes.js";

describe("collectCursorUntilMaxBytesLimit", () => {
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
        const result = await collectCursorUntilMaxBytesLimit({
            cursor,
            configuredMaxBytesPerQuery: maxBytes,
            toolResponseBytesLimit: 100_000,
        });
        expect(result.documents).toEqual(docs);
        expect(result.cappedBy).toBeUndefined();
    });

    it("returns all docs if maxBytesPerQuery is 0", async () => {
        const docs = Array.from({ length: 1000 }).map((_, idx) => ({ value: idx }));
        const cursor = createMockCursor(docs);
        const maxBytes = 0;
        const result = await collectCursorUntilMaxBytesLimit({
            cursor,
            configuredMaxBytesPerQuery: maxBytes,
            toolResponseBytesLimit: 100_000,
        });
        expect(result.documents).toEqual(docs);
        expect(result.cappedBy).toBeUndefined();
    });

    it("respects abort signal and breaks out of loop when aborted", async () => {
        const docs = Array.from({ length: 20 }).map((_, idx) => ({ value: idx }));
        const abortController = new AbortController();
        const cursor = createMockCursor(docs, { abortOnIdx: 9, abortController });
        const maxBytes = 10000;
        const result = await collectCursorUntilMaxBytesLimit({
            cursor,
            configuredMaxBytesPerQuery: maxBytes,
            abortSignal: abortController.signal,
            toolResponseBytesLimit: 100_000,
        });
        expect(result.documents).toEqual(Array.from({ length: 10 }).map((_, idx) => ({ value: idx })));
        expect(result.cappedBy).toBeUndefined(); // Aborted, not capped by limit
    });

    it("returns all docs if under maxBytesPerQuery", async () => {
        const docs = [{ a: 1 }, { b: 2 }];
        const cursor = createMockCursor(docs);
        const maxBytes = 10000;
        const result = await collectCursorUntilMaxBytesLimit({
            cursor,
            configuredMaxBytesPerQuery: maxBytes,
            toolResponseBytesLimit: 100_000,
        });
        expect(result.documents).toEqual(docs);
        expect(result.cappedBy).toBeUndefined();
    });

    it("returns only docs that fit under maxBytesPerQuery", async () => {
        const doc1 = { a: "x".repeat(100) };
        const doc2 = { b: "y".repeat(1000) };
        const docs = [doc1, doc2];
        const cursor = createMockCursor(docs);
        const maxBytes = calculateObjectSize(doc1) + 10;
        const result = await collectCursorUntilMaxBytesLimit({
            cursor,
            configuredMaxBytesPerQuery: maxBytes,
            toolResponseBytesLimit: 100_000,
        });
        expect(result.documents).toEqual([doc1]);
        expect(result.cappedBy).toBe("config.maxBytesPerQuery");
    });

    it("returns empty array if maxBytesPerQuery is smaller than even the first doc", async () => {
        const docs = [{ a: "x".repeat(100) }];
        const cursor = createMockCursor(docs);
        const result = await collectCursorUntilMaxBytesLimit({
            cursor,
            configuredMaxBytesPerQuery: 10,
            toolResponseBytesLimit: 100_000,
        });
        expect(result.documents).toEqual([]);
        expect(result.cappedBy).toBe("config.maxBytesPerQuery");
    });

    it("handles empty cursor", async () => {
        const cursor = createMockCursor([]);
        const result = await collectCursorUntilMaxBytesLimit({
            cursor,
            configuredMaxBytesPerQuery: 1000,
            toolResponseBytesLimit: 100_000,
        });
        expect(result.documents).toEqual([]);
        expect(result.cappedBy).toBeUndefined();
    });

    it("does not include a doc that would overflow the max bytes allowed", async () => {
        const doc1 = { a: "x".repeat(10) };
        const doc2 = { b: "y".repeat(1000) };
        const docs = [doc1, doc2];
        const cursor = createMockCursor(docs);
        // Set maxBytes so that after doc1, biggestDocSizeSoFar would prevent fetching doc2
        const maxBytes = calculateObjectSize(doc1) + calculateObjectSize(doc2) - 1;
        const result = await collectCursorUntilMaxBytesLimit({
            cursor,
            configuredMaxBytesPerQuery: maxBytes,
            toolResponseBytesLimit: 100_000,
        });
        // Should only include doc1, not doc2
        expect(result.documents).toEqual([doc1]);
        expect(result.cappedBy).toBe("config.maxBytesPerQuery");
    });

    it("caps by tool.responseBytesLimit when tool limit is lower than config", async () => {
        const doc1 = { a: "x".repeat(10) };
        const doc2 = { b: "y".repeat(1000) };
        const docs = [doc1, doc2];
        const cursor = createMockCursor(docs);
        const configLimit = 5000;
        const toolLimit = calculateObjectSize(doc1) + 10;
        const result = await collectCursorUntilMaxBytesLimit({
            cursor,
            configuredMaxBytesPerQuery: configLimit,
            toolResponseBytesLimit: toolLimit,
        });
        expect(result.documents).toEqual([doc1]);
        expect(result.cappedBy).toBe("tool.responseBytesLimit");
    });

    it("caps by config.maxBytesPerQuery when config limit is lower than tool", async () => {
        const doc1 = { a: "x".repeat(10) };
        const doc2 = { b: "y".repeat(1000) };
        const docs = [doc1, doc2];
        const cursor = createMockCursor(docs);
        const configLimit = calculateObjectSize(doc1) + 10;
        const toolLimit = 5000;
        const result = await collectCursorUntilMaxBytesLimit({
            cursor,
            configuredMaxBytesPerQuery: configLimit,
            toolResponseBytesLimit: toolLimit,
        });
        expect(result.documents).toEqual([doc1]);
        expect(result.cappedBy).toBe("config.maxBytesPerQuery");
    });

    it("caps by tool.responseBytesLimit when both limits are equal and reached", async () => {
        const doc = { a: "x".repeat(100) };
        const cursor = createMockCursor([doc, { b: 2 }]);
        const limit = calculateObjectSize(doc) + 10;
        const result = await collectCursorUntilMaxBytesLimit({
            cursor,
            configuredMaxBytesPerQuery: limit,
            toolResponseBytesLimit: limit,
        });
        expect(result.documents).toEqual([doc]);
        expect(result.cappedBy).toBe("tool.responseBytesLimit");
    });

    it("returns all docs and cappedBy undefined if both limits are negative, zero or null", async () => {
        const docs = [{ a: 1 }, { b: 2 }];
        const cursor = createMockCursor(docs);
        for (const limit of [-1, 0, null]) {
            const result = await collectCursorUntilMaxBytesLimit({
                cursor,
                configuredMaxBytesPerQuery: limit,
                toolResponseBytesLimit: limit,
            });
            expect(result.documents).toEqual(docs);
            expect(result.cappedBy).toBeUndefined();
        }
    });

    it("caps by tool.responseBytesLimit if config is zero/negative and tool limit is set", async () => {
        const doc1 = { a: "x".repeat(10) };
        const doc2 = { b: "y".repeat(1000) };
        const docs = [doc1, doc2];
        const cursor = createMockCursor(docs);
        const toolLimit = calculateObjectSize(doc1) + 10;
        const result = await collectCursorUntilMaxBytesLimit({
            cursor,
            configuredMaxBytesPerQuery: 0,
            toolResponseBytesLimit: toolLimit,
        });
        expect(result.documents).toEqual([doc1]);
        expect(result.cappedBy).toBe("tool.responseBytesLimit");
    });
});
