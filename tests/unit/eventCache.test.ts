import { describe, it, expect, beforeEach } from "vitest";
import { EventCache } from "../../src/telemetry/eventCache.js";
import type { BaseEvent } from "../../src/telemetry/types.js";

function createEvent(command: string): BaseEvent {
    return {
        timestamp: new Date().toISOString(),
        source: "mdbmcp",
        properties: { command, component: "test", duration_ms: 1, result: "success", category: "test" },
    };
}

describe("EventCache", () => {
    let cache: EventCache;

    beforeEach(() => {
        cache = new EventCache();
    });

    describe("processOldestBatch", () => {
        it("should remove events when the processor signals removeProcessed: true", async () => {
            cache.appendEvents([createEvent("a"), createEvent("b")]);
            expect(cache.size).toBe(2);

            const result = await cache.processOldestBatch(10, () =>
                Promise.resolve({ removeProcessed: true, result: "ok" })
            );

            expect(result).toBe("ok");
            expect(cache.size).toBe(0);
        });

        it("should keep events when the processor signals removeProcessed: false", async () => {
            cache.appendEvents([createEvent("a"), createEvent("b")]);

            const result = await cache.processOldestBatch(10, () =>
                Promise.resolve({ removeProcessed: false, result: "failed" })
            );

            expect(result).toBe("failed");
            expect(cache.size).toBe(2);
        });

        it("should return undefined when the cache is empty", async () => {
            const result = await cache.processOldestBatch(10, () =>
                Promise.resolve({ removeProcessed: true, result: "should-not-reach" })
            );

            expect(result).toBeUndefined();
        });

        it("should only process up to batchSize events", async () => {
            cache.appendEvents([createEvent("a"), createEvent("b"), createEvent("c")]);

            let receivedCount = 0;
            await cache.processOldestBatch(2, (events) => {
                receivedCount = events.length;
                return Promise.resolve({ removeProcessed: true, result: null });
            });

            expect(receivedCount).toBe(2);
            expect(cache.size).toBe(1);
            // The remaining event is whichever wasn't in the first batch
            const remaining = cache.getEvents().map((e) => e.event.properties.command);
            expect(remaining).toHaveLength(1);
        });

        it("should pass cached events to the processor", async () => {
            cache.appendEvents([createEvent("x"), createEvent("y")]);

            let receivedCommands: string[] = [];
            await cache.processOldestBatch(10, (events) => {
                receivedCommands = events.map((e) => e.properties.command as string);
                return Promise.resolve({ removeProcessed: true, result: null });
            });

            expect(receivedCommands).toEqual(expect.arrayContaining(["x", "y"]));
            expect(receivedCommands).toHaveLength(2);
        });

        it("should serialize concurrent calls so the second caller sees an empty cache", async () => {
            cache.appendEvents([createEvent("cached")]);

            const observedByFirst: string[] = [];
            const observedBySecond: string[] = [];

            let resolveFirst: (() => void) | undefined;
            const firstBlocked = new Promise<void>((r) => {
                resolveFirst = r;
            });

            const first = cache.processOldestBatch(10, async (events) => {
                observedByFirst.push(...events.map((e) => e.properties.command as string));
                await firstBlocked;
                return { removeProcessed: true, result: null };
            });

            const second = cache.processOldestBatch(10, (events) => {
                observedBySecond.push(...events.map((e) => e.properties.command as string));
                return Promise.resolve({ removeProcessed: true, result: null });
            });

            resolveFirst!();
            await Promise.all([first, second]);

            expect(observedByFirst).toEqual(["cached"]);
            expect(observedBySecond).toEqual([]);
        });

        it("should release the lock when the processor throws", async () => {
            cache.appendEvents([createEvent("survive")]);

            await expect(
                cache.processOldestBatch(10, () => {
                    throw new Error("boom");
                })
            ).rejects.toThrow("boom");

            // A subsequent call should be able to acquire the lock
            let secondRan = false;
            await cache.processOldestBatch(10, () => {
                secondRan = true;
                return Promise.resolve({ removeProcessed: true, result: null });
            });

            expect(secondRan).toBe(true);
        });

        it("should not duplicate cached events across concurrent calls even with delays", async () => {
            cache.appendEvents([createEvent("cached-marker")]);

            const allObserved: string[][] = [];

            let resolveFirst: (() => void) | undefined;
            const firstDelay = new Promise<void>((r) => {
                resolveFirst = r;
            });

            const first = cache.processOldestBatch(10, async (events) => {
                allObserved.push(events.map((e) => e.properties.command as string));
                await firstDelay;
                return { removeProcessed: true, result: null };
            });

            const second = cache.processOldestBatch(10, (events) => {
                allObserved.push(events.map((e) => e.properties.command as string));
                return Promise.resolve({ removeProcessed: true, result: null });
            });

            const third = cache.processOldestBatch(10, (events) => {
                allObserved.push(events.map((e) => e.properties.command as string));
                return Promise.resolve({ removeProcessed: true, result: null });
            });

            resolveFirst!();
            await Promise.all([first, second, third]);

            // Only the first processor should have seen the event; the others
            // never ran because the cache was empty (processOldestBatch returns
            // undefined without calling the processor).
            expect(allObserved).toHaveLength(1);
            expect(allObserved[0]).toEqual(["cached-marker"]);
        });
    });
});
