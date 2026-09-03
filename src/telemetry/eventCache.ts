import { LRUCache } from "lru-cache";
import type { BaseEvent } from "./types.js";

/**
 * In-memory telemetry event cache. Each telemetry pipeline owns its own
 * instance so events are only ever sent through the pipeline that emitted them.
 * Uses LRU cache to automatically drop oldest events when limit is exceeded
 */
export class EventCache<T extends BaseEvent = BaseEvent> {
    private static readonly MAX_EVENTS = 1000;

    private cache: LRUCache<number, T>;
    private nextId = 0;
    /** Current exclusive operation, if any. The next caller awaits this before starting. */
    private currentOperation: { promise: Promise<void>; resolve: () => void } | undefined;

    constructor() {
        this.cache = new LRUCache({
            max: EventCache.MAX_EVENTS,
            // Using FIFO eviction strategy for events
            allowStale: false,
            updateAgeOnGet: false,
        });
    }

    /**
     * Gets the number of currently cached events
     */
    public get size(): number {
        return this.cache.size;
    }

    /**
     * Runs a callback with exclusive access to the cache so operations
     * are serialized across all callers (e.g. the send timer racing a close() flush).
     */
    private async runExclusive<R>(fn: () => Promise<R>): Promise<R> {
        const prevOperation = this.currentOperation;

        let resolve: (() => void) | undefined;
        const promise = new Promise<void>((res) => {
            resolve = res;
        });
        // resolve is guaranteed to be assigned by the Promise constructor
        const release = resolve as () => void;
        this.currentOperation = { promise, resolve: release };

        await prevOperation?.promise;

        try {
            return await fn();
        } finally {
            release();
        }
    }

    /**
     * Under exclusive access: takes up to `batchSize` oldest events and passes them
     * to the processor. If the processor signals `removeProcessed: true`, those events
     * are removed from the cache; otherwise they remain untouched.
     * Returns the `result` from the processor, or `undefined` if the cache was empty.
     */
    public async processOldestBatch<R>(
        batchSize: number,
        processor: (events: T[]) => Promise<{ removeProcessed: boolean; result: R }>
    ): Promise<R | undefined> {
        return this.runExclusive(async () => {
            const allEvents = this.getEvents();
            const batch = allEvents.slice(0, batchSize);
            if (batch.length === 0) return undefined;

            try {
                const { removeProcessed, result } = await processor(batch.map((e) => e.event));
                if (removeProcessed) {
                    this.removeEvents(batch.map((e) => e.id));
                }
                return result;
            } catch {
                // Processor threw — leave events in cache for retry
                return undefined;
            }
        });
    }

    /**
     * Gets a copy of the currently cached events along with their ids
     * @returns Array of cached BaseEvent objects
     */
    public getEvents(): { id: number; event: T }[] {
        return Array.from(this.cache.entries()).map(([id, event]) => ({ id, event }));
    }

    /**
     * Appends new events to the cache.
     * LRU cache automatically handles dropping oldest events when limit is exceeded.
     */
    public appendEvents(events: T[]): void {
        for (const event of events) {
            this.cache.set(this.nextId++, event);
        }
    }

    /**
     * Removes cached events by their ids
     */
    public removeEvents(ids: number[]): void {
        for (const id of ids) {
            this.cache.delete(id);
        }
    }
}
