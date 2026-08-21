import { describe, it, expect, vi, beforeEach } from "vitest";
import { SessionStore, SessionLimitExceededError, type CloseableTransport } from "../../src/common/sessionStore.js";
import type { LoggerBase } from "../../src/common/logging/index.js";
import type { Session } from "../../src/common/session.js";
import { MockMetrics } from "./mocks/metrics.js";

function createMockTransport(): CloseableTransport {
    return { close: vi.fn().mockResolvedValue(undefined) };
}

function createMockLogger(): LoggerBase {
    return {
        info: vi.fn(),
        debug: vi.fn(),
        warning: vi.fn(),
        error: vi.fn(),
    } as unknown as LoggerBase;
}

function createMockSession(): Session {
    return { logger: createMockLogger() } as unknown as Session;
}

describe("SessionStore metrics", () => {
    let metrics: MockMetrics;
    let logger: LoggerBase;
    let store: SessionStore;

    beforeEach(() => {
        metrics = new MockMetrics();
        logger = createMockLogger();
        store = new SessionStore({
            options: { idleTimeoutMS: 60_000, notificationTimeoutMS: 30_000, maxSessions: 100 },
            logger,
            metrics,
        });
    });

    it("increments sessionCreated when a session is added", async () => {
        await store.addSession({
            sessionId: "s1",
            transport: createMockTransport(),
            logger: createMockLogger(),
            session: createMockSession(),
        });

        const { values } = await metrics.get("sessionCreated").get();
        expect(values[0]?.value).toBe(1);
    });

    it("increments sessionCreated for each new session", async () => {
        await store.addSession({
            sessionId: "s1",
            transport: createMockTransport(),
            logger: createMockLogger(),
            session: createMockSession(),
        });
        await store.addSession({
            sessionId: "s2",
            transport: createMockTransport(),
            logger: createMockLogger(),
            session: createMockSession(),
        });

        const { values } = await metrics.get("sessionCreated").get();
        expect(values[0]?.value).toBe(2);
    });

    it("increments sessionClosed with reason when a session is closed", async () => {
        await store.addSession({
            sessionId: "s1",
            transport: createMockTransport(),
            logger: createMockLogger(),
            session: createMockSession(),
        });
        await store.closeSession({ sessionId: "s1", reason: "transport_closed" });

        const { values } = await metrics.get("sessionClosed").get();
        const sample = values.find((v) => v.labels.reason === "transport_closed");
        expect(sample?.value).toBe(1);
    });

    it("records reason 'server_stop' when closeAllSessions is called", async () => {
        await store.addSession({
            sessionId: "s1",
            transport: createMockTransport(),
            logger: createMockLogger(),
            session: createMockSession(),
        });
        await store.addSession({
            sessionId: "s2",
            transport: createMockTransport(),
            logger: createMockLogger(),
            session: createMockSession(),
        });
        await store.closeAllSessions();

        const { values } = await metrics.get("sessionClosed").get();
        const sample = values.find((v) => v.labels.reason === "server_stop");
        expect(sample?.value).toBe(2);
    });

    it("records reason 'idle_timeout' when session times out", async () => {
        vi.useFakeTimers();
        try {
            await store.addSession({
                sessionId: "s1",
                transport: createMockTransport(),
                logger: createMockLogger(),
                session: createMockSession(),
            });

            await vi.advanceTimersByTimeAsync(60_001);

            const { values } = await metrics.get("sessionClosed").get();
            const sample = values.find((v) => v.labels.reason === "idle_timeout");
            expect(sample?.value).toBe(1);
        } finally {
            vi.useRealTimers();
        }
    });

    it("does not call transport.close() when reason is transport_closed", async () => {
        const closeFn = vi.fn().mockResolvedValue(undefined);
        await store.addSession({
            sessionId: "s1",
            transport: { close: closeFn },
            logger: createMockLogger(),
            session: createMockSession(),
        });
        await store.closeSession({ sessionId: "s1", reason: "transport_closed" });

        expect(closeFn).not.toHaveBeenCalled();
    });

    it("calls transport.close() for server-initiated close reasons", async () => {
        const closeFn1 = vi.fn().mockResolvedValue(undefined);
        const closeFn2 = vi.fn().mockResolvedValue(undefined);
        await store.addSession({
            sessionId: "s1",
            transport: { close: closeFn1 },
            logger: createMockLogger(),
            session: createMockSession(),
        });
        await store.addSession({
            sessionId: "s2",
            transport: { close: closeFn2 },
            logger: createMockLogger(),
            session: createMockSession(),
        });

        await store.closeSession({ sessionId: "s1", reason: "server_stop" });
        await store.closeSession({ sessionId: "s2", reason: "idle_timeout" });

        expect(closeFn1).toHaveBeenCalledOnce();
        expect(closeFn2).toHaveBeenCalledOnce();
    });

    it("tracks separate reasons independently", async () => {
        await store.addSession({
            sessionId: "s1",
            transport: createMockTransport(),
            logger: createMockLogger(),
            session: createMockSession(),
        });
        await store.addSession({
            sessionId: "s2",
            transport: createMockTransport(),
            logger: createMockLogger(),
            session: createMockSession(),
        });
        await store.addSession({
            sessionId: "s3",
            transport: createMockTransport(),
            logger: createMockLogger(),
            session: createMockSession(),
        });

        await store.closeSession({ sessionId: "s1", reason: "transport_closed" });
        await store.closeSession({ sessionId: "s2", reason: "transport_closed" });
        await store.closeSession({ sessionId: "s3", reason: "server_stop" });

        const { values } = await metrics.get("sessionClosed").get();
        expect(values.find((v) => v.labels.reason === "transport_closed")?.value).toBe(2);
        expect(values.find((v) => v.labels.reason === "server_stop")?.value).toBe(1);
    });
});

describe("SessionStore.hasSession", () => {
    let store: SessionStore;

    beforeEach(() => {
        store = new SessionStore({
            options: { idleTimeoutMS: 60_000, notificationTimeoutMS: 30_000, maxSessions: 100 },
            logger: createMockLogger(),
            metrics: new MockMetrics(),
        });
    });

    it("returns whether the session exists", async () => {
        expect(store.hasSession("s1")).toBe(false);

        await store.addSession({
            sessionId: "s1",
            transport: createMockTransport(),
            logger: createMockLogger(),
            session: createMockSession(),
        });

        expect(store.hasSession("s1")).toBe(true);

        await store.closeSession({ sessionId: "s1" });
        expect(store.hasSession("s1")).toBe(false);
    });

    it("does not reset the idle timeout, unlike getSession", async () => {
        vi.useFakeTimers();
        try {
            await store.addSession({
                sessionId: "probed",
                transport: createMockTransport(),
                logger: createMockLogger(),
                session: createMockSession(),
            });
            await store.addSession({
                sessionId: "accessed",
                transport: createMockTransport(),
                logger: createMockLogger(),
                session: createMockSession(),
            });

            await vi.advanceTimersByTimeAsync(30_000);
            store.hasSession("probed");
            await store.getSession("accessed");
            await vi.advanceTimersByTimeAsync(30_001);

            // "probed" idled out 60s after creation; "accessed" got a fresh
            // 60s window when getSession reset its timeout.
            expect(store.hasSession("probed")).toBe(false);
            expect(store.hasSession("accessed")).toBe(true);
        } finally {
            vi.useRealTimers();
        }
    });
});

describe("SessionStore maxSessions", () => {
    it("rejects a constructor maxSessions value below 1", () => {
        expect(
            () =>
                new SessionStore({
                    options: { idleTimeoutMS: 60_000, notificationTimeoutMS: 30_000, maxSessions: 0 },
                    logger: createMockLogger(),
                    metrics: new MockMetrics(),
                })
        ).toThrow("maxSessions must be at least 1");
    });

    it("allows sessions up to the configured limit", async () => {
        const store = new SessionStore({
            options: { idleTimeoutMS: 60_000, notificationTimeoutMS: 30_000, maxSessions: 2 },
            logger: createMockLogger(),
            metrics: new MockMetrics(),
        });

        await store.addSession({
            sessionId: "s1",
            transport: createMockTransport(),
            logger: createMockLogger(),
            session: createMockSession(),
        });
        await store.addSession({
            sessionId: "s2",
            transport: createMockTransport(),
            logger: createMockLogger(),
            session: createMockSession(),
        });

        expect(store.hasSession("s1")).toBe(true);
        expect(store.hasSession("s2")).toBe(true);
    });

    it("throws SessionLimitExceededError once the limit is reached", async () => {
        const store = new SessionStore({
            options: { idleTimeoutMS: 60_000, notificationTimeoutMS: 30_000, maxSessions: 1 },
            logger: createMockLogger(),
            metrics: new MockMetrics(),
        });

        await store.addSession({
            sessionId: "s1",
            transport: createMockTransport(),
            logger: createMockLogger(),
            session: createMockSession(),
        });

        await expect(
            store.addSession({
                sessionId: "s2",
                transport: createMockTransport(),
                logger: createMockLogger(),
                session: createMockSession(),
            })
        ).rejects.toThrow(SessionLimitExceededError);

        expect(store.hasSession("s2")).toBe(false);
    });

    it("frees a slot when a session is closed", async () => {
        const store = new SessionStore({
            options: { idleTimeoutMS: 60_000, notificationTimeoutMS: 30_000, maxSessions: 1 },
            logger: createMockLogger(),
            metrics: new MockMetrics(),
        });

        await store.addSession({
            sessionId: "s1",
            transport: createMockTransport(),
            logger: createMockLogger(),
            session: createMockSession(),
        });
        await store.closeSession({ sessionId: "s1" });

        await store.addSession({
            sessionId: "s2",
            transport: createMockTransport(),
            logger: createMockLogger(),
            session: createMockSession(),
        });

        expect(store.hasSession("s2")).toBe(true);
    });
});

describe("SessionStore LRU idle-eviction", () => {
    // idleTimeoutMS is set well above the 2-min grace so an idle session is evictable
    // by the LRU valve before the background reaper would remove it.
    function makeStore(maxSessions: number, metrics: MockMetrics = new MockMetrics()): SessionStore {
        return new SessionStore({
            options: {
                idleTimeoutMS: 600_000,
                notificationTimeoutMS: 30_000,
                maxSessions,
                evictionIdleGraceMS: 120_000,
            },
            logger: createMockLogger(),
            metrics,
        });
    }

    it("evicts the least-recently-used idle session to admit a new one at capacity", async () => {
        vi.useFakeTimers();
        try {
            const metrics = new MockMetrics();
            const store = makeStore(2, metrics);
            const s1Close = vi.fn().mockResolvedValue(undefined);

            await store.addSession({
                sessionId: "s1",
                transport: { close: s1Close },
                logger: createMockLogger(),
                session: createMockSession(),
            });
            await store.addSession({
                sessionId: "s2",
                transport: createMockTransport(),
                logger: createMockLogger(),
                session: createMockSession(),
            });

            // Both idle 2.5 min (> 2-min grace, < 10-min reaper); touch s2 so s1 is the LRU.
            await vi.advanceTimersByTimeAsync(150_000);
            await store.getSession("s2");

            await store.addSession({
                sessionId: "s3",
                transport: createMockTransport(),
                logger: createMockLogger(),
                session: createMockSession(),
            });

            expect(store.hasSession("s1")).toBe(false); // evicted: LRU, idle past grace
            expect(store.hasSession("s2")).toBe(true); // recently used, preserved
            expect(store.hasSession("s3")).toBe(true); // admitted
            expect(s1Close).toHaveBeenCalledOnce(); // local transport torn down

            const evicted = (await metrics.get("sessionClosed").get()).values.find(
                (v) => v.labels.reason === "evicted"
            );
            expect(evicted?.value).toBe(1);
            // Exactly at capacity again: one evicted, one admitted.
            expect((await metrics.get("sessionsActive").get()).values[0]?.value).toBe(2);
        } finally {
            vi.useRealTimers();
        }
    });

    it("rejects a new session when no session is idle past the grace", async () => {
        vi.useFakeTimers();
        try {
            const store = makeStore(1);
            await store.addSession({
                sessionId: "s1",
                transport: createMockTransport(),
                logger: createMockLogger(),
                session: createMockSession(),
            });

            // s1 idle only 1 min — under the 2-min grace, so it must not be evicted.
            await vi.advanceTimersByTimeAsync(60_000);

            await expect(
                store.addSession({
                    sessionId: "s2",
                    transport: createMockTransport(),
                    logger: createMockLogger(),
                    session: createMockSession(),
                })
            ).rejects.toThrow(SessionLimitExceededError);

            expect(store.hasSession("s1")).toBe(true); // incumbent preserved
            expect(store.hasSession("s2")).toBe(false); // newcomer rejected
        } finally {
            vi.useRealTimers();
        }
    });

    it("evicts once a previously-too-fresh session crosses the grace", async () => {
        vi.useFakeTimers();
        try {
            const store = makeStore(1);
            await store.addSession({
                sessionId: "s1",
                transport: createMockTransport(),
                logger: createMockLogger(),
                session: createMockSession(),
            });

            // Just under the grace -> reject.
            await vi.advanceTimersByTimeAsync(119_000);
            await expect(
                store.addSession({
                    sessionId: "s2",
                    transport: createMockTransport(),
                    logger: createMockLogger(),
                    session: createMockSession(),
                })
            ).rejects.toThrow(SessionLimitExceededError);

            // Cross the grace -> s1 now evictable.
            await vi.advanceTimersByTimeAsync(2_000);
            await store.addSession({
                sessionId: "s3",
                transport: createMockTransport(),
                logger: createMockLogger(),
                session: createMockSession(),
            });

            expect(store.hasSession("s1")).toBe(false);
            expect(store.hasSession("s3")).toBe(true);
        } finally {
            vi.useRealTimers();
        }
    });
});

describe("SessionStore eviction under concurrent admissions", () => {
    function makeStore(maxSessions: number, metrics: MockMetrics): SessionStore {
        return new SessionStore({
            options: {
                idleTimeoutMS: 600_000,
                notificationTimeoutMS: 30_000,
                maxSessions,
                evictionIdleGraceMS: 120_000,
            },
            logger: createMockLogger(),
            metrics,
        });
    }

    function add(store: SessionStore, sessionId: string): Promise<void> {
        return store.addSession({
            sessionId,
            transport: createMockTransport(),
            logger: createMockLogger(),
            session: createMockSession(),
        });
    }

    // addSession has no await between the capacity check and the map insert (the eviction is a
    // fire-and-forget closeSession that deletes the victim synchronously). So concurrently-issued
    // admissions run to completion one at a time: each evicts exactly one LRU victim and the map
    // never exceeds the cap. Were eviction ever awaited, a second admission could observe the
    // freed slot mid-teardown and over-fill — these tests would catch that.
    it("admits a full concurrent burst without over-evicting or exceeding the cap", async () => {
        vi.useFakeTimers();
        try {
            const metrics = new MockMetrics();
            const store = makeStore(3, metrics);

            await add(store, "s1");
            await add(store, "s2");
            await add(store, "s3");

            // All three incumbents idle past the grace, so all are evictable.
            await vi.advanceTimersByTimeAsync(150_000);

            // Three admissions issued in the same tick, each arriving at capacity.
            await Promise.all([add(store, "s4"), add(store, "s5"), add(store, "s6")]);

            // Each admission evicted one distinct LRU incumbent; every newcomer survived.
            expect(store.hasSession("s1")).toBe(false);
            expect(store.hasSession("s2")).toBe(false);
            expect(store.hasSession("s3")).toBe(false);
            expect(store.hasSession("s4")).toBe(true);
            expect(store.hasSession("s5")).toBe(true);
            expect(store.hasSession("s6")).toBe(true);

            // Exactly one eviction per admission — not more (no over-eviction) — and the store is
            // back at exactly the cap (no over-capacity).
            expect(
                (await metrics.get("sessionClosed").get()).values.find((v) => v.labels.reason === "evicted")?.value
            ).toBe(3);
            expect((await metrics.get("sessionsActive").get()).values[0]?.value).toBe(3);
        } finally {
            vi.useRealTimers();
        }
    });

    it("admits only as many as it can evict and rejects the excess, never evicting a fresh newcomer", async () => {
        vi.useFakeTimers();
        try {
            const metrics = new MockMetrics();
            const store = makeStore(2, metrics);

            await add(store, "s1");
            await add(store, "s2");

            // Only the two incumbents are idle past the grace.
            await vi.advanceTimersByTimeAsync(150_000);

            // Four admissions at capacity, but only two idle victims exist to make room.
            const results = await Promise.allSettled([
                add(store, "s3"),
                add(store, "s4"),
                add(store, "s5"),
                add(store, "s6"),
            ]);

            // Two admitted (evicting the two idle incumbents), two rejected — the fresh
            // just-admitted sessions are protected by the grace, so the burst can't cascade into
            // evicting its own newcomers.
            expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(2);
            expect(results.filter((r) => r.status === "rejected")).toHaveLength(2);
            for (const r of results) {
                if (r.status === "rejected") {
                    expect(r.reason).toBeInstanceOf(SessionLimitExceededError);
                }
            }

            expect(store.hasSession("s1")).toBe(false);
            expect(store.hasSession("s2")).toBe(false);
            expect(store.hasSession("s3")).toBe(true);
            expect(store.hasSession("s4")).toBe(true);
            expect(store.hasSession("s5")).toBe(false);
            expect(store.hasSession("s6")).toBe(false);

            // Only the two idle incumbents were evicted — never a freshly-admitted session.
            expect(
                (await metrics.get("sessionClosed").get()).values.find((v) => v.labels.reason === "evicted")?.value
            ).toBe(2);
            expect((await metrics.get("sessionsActive").get()).values[0]?.value).toBe(2);
        } finally {
            vi.useRealTimers();
        }
    });
});
