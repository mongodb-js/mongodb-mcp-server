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

    describe("processAndClear", () => {
        it("should remove events from the cache when the processor returns an empty array", async () => {
            cache.appendEvents([createEvent("a"), createEvent("b")]);
            expect(cache.size).toBe(2);

            await cache.processAndClear(() => Promise.resolve([]));

            expect(cache.size).toBe(0);
        });

        it("should re-cache events returned by the processor", async () => {
            const eventA = createEvent("a");
            cache.appendEvents([eventA, createEvent("b")]);

            await cache.processAndClear(() => Promise.resolve([eventA]));

            expect(cache.size).toBe(1);
            const remaining = cache.getEvents();
            expect(remaining[0]?.event.properties.command).toBe("a");
        });

        it("should pass cached events to the processor", async () => {
            cache.appendEvents([createEvent("x"), createEvent("y")]);

            let receivedCommands: string[] = [];
            await cache.processAndClear((events) => {
                receivedCommands = events.map((e) => e.properties.command as string);
                return Promise.resolve([]);
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

            const first = cache.processAndClear(async (events) => {
                observedByFirst.push(...events.map((e) => e.properties.command as string));
                await firstBlocked;
                return [];
            });

            const second = cache.processAndClear((events) => {
                observedBySecond.push(...events.map((e) => e.properties.command as string));
                return Promise.resolve([]);
            });

            // The second call should be blocked while the first holds the lock.
            // Release the first after a tick to let the second proceed.
            resolveFirst!();

            await Promise.all([first, second]);

            expect(observedByFirst).toEqual(["cached"]);
            expect(observedBySecond).toEqual([]);
        });

        it("should serialize three concurrent calls in order", async () => {
            cache.appendEvents([createEvent("initial")]);

            const order: number[] = [];

            let resolve1: (() => void) | undefined;
            let resolve2: (() => void) | undefined;
            const block1 = new Promise<void>((r) => {
                resolve1 = r;
            });
            const block2 = new Promise<void>((r) => {
                resolve2 = r;
            });

            const p1 = cache.processAndClear(async () => {
                order.push(1);
                await block1;
                return [createEvent("from-first")];
            });

            const p2 = cache.processAndClear(async (events) => {
                order.push(2);
                expect(events.map((e) => e.properties.command)).toEqual(["from-first"]);
                await block2;
                return [];
            });

            const p3 = cache.processAndClear((events) => {
                order.push(3);
                expect(events).toEqual([]);
                return Promise.resolve([]);
            });

            resolve1!();
            resolve2!();
            await Promise.all([p1, p2, p3]);

            expect(order).toEqual([1, 2, 3]);
        });

        it("should release the lock when the processor throws", async () => {
            cache.appendEvents([createEvent("survive")]);

            await expect(
                cache.processAndClear(() => {
                    throw new Error("boom");
                })
            ).rejects.toThrow("boom");

            // Events should still be in the cache because the processor threw
            // before returning (processAndClear removes before calling processor,
            // then re-adds what it returns — but the throw prevents the re-add
            // from the return path, so the original removal stands).
            // A subsequent call should be able to acquire the lock.
            let secondRan = false;
            await cache.processAndClear(() => {
                secondRan = true;
                return Promise.resolve([]);
            });

            expect(secondRan).toBe(true);
        });

        it("should not duplicate cached events across concurrent calls even with delays", async () => {
            const CACHED = createEvent("cached-marker");
            cache.appendEvents([CACHED]);

            const allObserved: string[][] = [];

            let resolveFirst: (() => void) | undefined;
            const firstDelay = new Promise<void>((r) => {
                resolveFirst = r;
            });

            const first = cache.processAndClear(async (events) => {
                allObserved.push(events.map((e) => e.properties.command as string));
                await firstDelay;
                return [];
            });

            const second = cache.processAndClear((events) => {
                allObserved.push(events.map((e) => e.properties.command as string));
                return Promise.resolve([]);
            });

            const third = cache.processAndClear((events) => {
                allObserved.push(events.map((e) => e.properties.command as string));
                return Promise.resolve([]);
            });

            resolveFirst!();
            await Promise.all([first, second, third]);

            const totalCachedMarkerSeen = allObserved.flat().filter((cmd) => cmd === "cached-marker").length;
            expect(totalCachedMarkerSeen, "cached event should be observed by exactly one processor").toBe(1);
            expect(allObserved[0]).toEqual(["cached-marker"]);
            expect(allObserved[1]).toEqual([]);
            expect(allObserved[2]).toEqual([]);
        });
    });
});
