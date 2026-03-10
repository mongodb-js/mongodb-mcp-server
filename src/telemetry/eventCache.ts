import { LRUCache } from "lru-cache";
import type { BaseEvent } from "./types.js";

/**
 * Singleton class for in-memory telemetry event caching
 * Provides a central storage for telemetry events that couldn't be sent
 * Uses LRU cache to automatically drop oldest events when limit is exceeded
 */
export class EventCache {
    private static instance: EventCache;
    private static readonly MAX_EVENTS = 1000;

    private cache: LRUCache<number, BaseEvent>;
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
     * Gets the singleton instance of EventCache
     * @returns The EventCache instance
     */
    public static getInstance(): EventCache {
        if (!EventCache.instance) {
            EventCache.instance = new EventCache();
        }
        return EventCache.instance;
    }

    /**
     * Gets the number of currently cached events
     */
    public get size(): number {
        return this.cache.size;
    }

    /**
     * Runs a callback with exclusive access to the cache so operations
     * are serialized across all callers (e.g. multiple Telemetry instances / sessions).
     */
    public async runExclusive<T>(fn: () => Promise<T>): Promise<T> {
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
     * Under exclusive access: reads cached events, merges with newEvents, runs processor,
     * then clears sent cached events on success. On failure, newEvents are appended
     * for retry and the error is re-thrown.
     */
    public async processAndClear(
        newEvents: BaseEvent[],
        processor: (allEvents: BaseEvent[], cachedCount: number) => Promise<void>
    ): Promise<void> {
        await this.runExclusive(async () => {
            const cachedEvents = this.getEvents();
            const allEvents = [...cachedEvents.map((e) => e.event), ...newEvents];

            try {
                await processor(allEvents, cachedEvents.length);
                this.removeEvents(cachedEvents.map((e) => e.id));
            } catch (error) {
                this.appendEvents(newEvents);
                throw error;
            }
        });
    }

    /**
     * Gets a copy of the currently cached events along with their ids
     * @returns Array of cached BaseEvent objects
     */
    public getEvents(): { id: number; event: BaseEvent }[] {
        return Array.from(this.cache.entries()).map(([id, event]) => ({ id, event }));
    }

    /**
     * Appends new events to the cache.
     * LRU cache automatically handles dropping oldest events when limit is exceeded.
     */
    public appendEvents(events: BaseEvent[]): void {
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
