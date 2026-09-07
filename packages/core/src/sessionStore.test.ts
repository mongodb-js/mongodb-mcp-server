import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ILogger } from "@mongodb-js/mcp-types";
import { MockMetrics } from "@mongodb-js/mcp-test-utils";
import { LegacySessionStore, SessionLimitExceededError, type SessionCloseReason } from "./sessionStore.js";

/** A generic session value: a plain closable object. */
function makeValue(id: string): { id: string; close: ReturnType<typeof vi.fn> } {
    return { id, close: vi.fn().mockResolvedValue(undefined) };
}

function createMockLogger(): ILogger {
    return {
        info: vi.fn(),
        debug: vi.fn(),
        warning: vi.fn(),
        error: vi.fn(),
    } as unknown as ILogger;
}

/** The value type held by the store under test. */
type TestValue = { id: string; close: ReturnType<typeof vi.fn> };

/** One session the store closed, as observed by the handler. */
type ClosedRecord = { id: string; reason: SessionCloseReason };

function makeStore(
    options: Partial<
        Record<"maxSessions" | "idleTimeoutMS" | "notificationTimeoutMS" | "evictionIdleGraceMS", number>
    > = {}
): { store: LegacySessionStore<TestValue>; closed: ClosedRecord[]; metrics: MockMetrics } {
    const closed: ClosedRecord[] = [];
    const metrics = new MockMetrics();
    const store = new LegacySessionStore<TestValue>({
        options,
        logger: createMockLogger(),
        metrics,
        onSessionClosed: (value, reason): void => {
            closed.push({ id: value.id, reason });
        },
    });
    return { store, closed, metrics };
}

describe("LegacySessionStore lifecycle", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("holds sessions up to the configured maxSessions", () => {
        const { store } = makeStore({ maxSessions: 2 });
        store.addSession({ sessionId: "s1", value: makeValue("s1") });
        store.addSession({ sessionId: "s2", value: makeValue("s2") });

        expect(store.size).toBe(2);
        expect(store.hasSession("s1")).toBe(true);
        expect(store.hasSession("s2")).toBe(true);
    });

    it("resets a session's liveness on getSession", () => {
        const { store } = makeStore({ maxSessions: 5, idleTimeoutMS: 60_000, notificationTimeoutMS: 30_000 });
        store.addSession({ sessionId: "s1", value: makeValue("s1") });

        // Refresh s1 before its idle timeout elapses; it must survive.
        vi.advanceTimersByTime(30_000);
        expect(store.getSession("s1")).toBeDefined();
        vi.advanceTimersByTime(40_000);
        expect(store.hasSession("s1")).toBe(true);
    });

    it("closes a session on closeSession and reports it through onSessionClosed", async () => {
        const { store, closed } = makeStore({ maxSessions: 5 });
        store.addSession({ sessionId: "s1", value: makeValue("s1") });

        await store.closeSession({ sessionId: "s1", reason: "transport_closed" });

        expect(store.hasSession("s1")).toBe(false);
        expect(closed).toContainEqual({ id: "s1", reason: "transport_closed" });
    });

    it("closes every session on closeAllSessions", async () => {
        const { store, closed } = makeStore({ maxSessions: 5 });
        store.addSession({ sessionId: "s1", value: makeValue("s1") });
        store.addSession({ sessionId: "s2", value: makeValue("s2") });

        await store.closeAllSessions();

        expect(store.size).toBe(0);
        expect(closed).toHaveLength(2);
        expect(closed.every((c) => c.reason === "server_stop")).toBe(true);
    });

    it("tracks session metrics across the lifecycle", async () => {
        const { store, metrics } = makeStore({ maxSessions: 5 });
        store.addSession({ sessionId: "s1", value: makeValue("s1") });
        store.addSession({ sessionId: "s2", value: makeValue("s2") });

        expect((await metrics.get("sessionCreated").get()).values[0]?.value).toBe(2);
        expect((await metrics.get("sessionsActive").get()).values[0]?.value).toBe(2);

        await store.closeSession({ sessionId: "s1", reason: "transport_closed" });

        const closed = (await metrics.get("sessionClosed").get()).values.find(
            (v) => v.labels.reason === "transport_closed"
        );
        expect(closed?.value).toBe(1);
        expect((await metrics.get("sessionsActive").get()).values[0]?.value).toBe(1);
    });
});

describe("LegacySessionStore maxSessions", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("rejects a maxSessions below 1 at construction", () => {
        expect(() => makeStore({ maxSessions: 0 })).toThrow("maxSessions must be at least 1");
    });

    it("throws SessionLimitExceededError once the cap is reached and nothing is idle", () => {
        const { store } = makeStore({ maxSessions: 1, evictionIdleGraceMS: 120_000 });
        store.addSession({ sessionId: "s1", value: makeValue("s1") });

        // s1 was just created (idle 0ms) — under the 120s grace, so it must not be evicted.
        expect(() => store.addSession({ sessionId: "s2", value: makeValue("s2") })).toThrow(SessionLimitExceededError);
        expect(store.hasSession("s1")).toBe(true);
        expect(store.hasSession("s2")).toBe(false);
        expect(store.size).toBe(1);
    });

    it("evicts the least-recently-used idle session at the cap", () => {
        const { store, closed } = makeStore({ maxSessions: 2, evictionIdleGraceMS: 120_000 });
        store.addSession({ sessionId: "s1", value: makeValue("s1") });
        store.addSession({ sessionId: "s2", value: makeValue("s2") });

        // Both idle past the grace; refresh s2 so s1 is the LRU.
        vi.advanceTimersByTime(150_000);
        store.getSession("s2");

        store.addSession({ sessionId: "s3", value: makeValue("s3") });

        expect(store.hasSession("s1")).toBe(false); // evicted: LRU, idle past grace
        expect(store.hasSession("s2")).toBe(true); // recently used, preserved
        expect(store.hasSession("s3")).toBe(true); // admitted
        expect(closed).toContainEqual({ id: "s1", reason: "evicted" });
    });

    it("evicts once a previously-too-fresh session crosses the grace", () => {
        const { store } = makeStore({ maxSessions: 1, evictionIdleGraceMS: 120_000 });
        store.addSession({ sessionId: "s1", value: makeValue("s1") });

        // Just under the grace -> reject.
        vi.advanceTimersByTime(119_000);
        expect(() => store.addSession({ sessionId: "s2", value: makeValue("s2") })).toThrow(SessionLimitExceededError);

        // Cross the grace -> s1 now evictable.
        vi.advanceTimersByTime(2_000);
        store.addSession({ sessionId: "s3", value: makeValue("s3") });
        expect(store.hasSession("s1")).toBe(false);
        expect(store.hasSession("s3")).toBe(true);
    });
});

describe("LegacySessionStore timeouts", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("reaps a session that stays idle past idleTimeoutMS", () => {
        const { store, closed } = makeStore({
            maxSessions: 5,
            idleTimeoutMS: 60_000,
            notificationTimeoutMS: 30_000,
        });
        store.addSession({ sessionId: "s1", value: makeValue("s1") });
        store.addSession({ sessionId: "s2", value: makeValue("s2") });

        // Keep s2 alive partway; s1 stays idle the whole time.
        vi.advanceTimersByTime(30_000);
        store.getSession("s2");
        vi.advanceTimersByTime(30_000);

        expect(store.hasSession("s1")).toBe(false);
        expect(closed).toContainEqual({ id: "s1", reason: "idle_timeout" });
        expect(store.hasSession("s2")).toBe(true);
    });

    it("keeps a session alive while it is touched", () => {
        const { store } = makeStore({ maxSessions: 5, idleTimeoutMS: 60_000, notificationTimeoutMS: 30_000 });
        store.addSession({ sessionId: "s1", value: makeValue("s1") });

        for (let i = 0; i < 5; i++) {
            vi.advanceTimersByTime(20_000);
            store.getSession("s1"); // resets timers
        }
        expect(store.hasSession("s1")).toBe(true);
    });
});

describe("LegacySessionStore concurrent admissions", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("admits a full concurrent burst without over-evicting or exceeding the cap", () => {
        const { store, closed } = makeStore({ maxSessions: 3, evictionIdleGraceMS: 120_000 });
        store.addSession({ sessionId: "s1", value: makeValue("s1") });
        store.addSession({ sessionId: "s2", value: makeValue("s2") });
        store.addSession({ sessionId: "s3", value: makeValue("s3") });

        // All incumbents idle past the grace, so all are evictable.
        vi.advanceTimersByTime(150_000);

        // Same-tick admissions; each evicts one LRU incumbent.
        store.addSession({ sessionId: "s4", value: makeValue("s4") });
        store.addSession({ sessionId: "s5", value: makeValue("s5") });
        store.addSession({ sessionId: "s6", value: makeValue("s6") });

        expect(store.hasSession("s1")).toBe(false);
        expect(store.hasSession("s2")).toBe(false);
        expect(store.hasSession("s3")).toBe(false);
        expect(store.hasSession("s4")).toBe(true);
        expect(store.hasSession("s5")).toBe(true);
        expect(store.hasSession("s6")).toBe(true);
        expect(store.size).toBe(3); // exactly the cap
        expect(closed.filter((c) => c.reason === "evicted")).toHaveLength(3);
    });

    it("rejects the excess once no idle victim remains", () => {
        const { store } = makeStore({ maxSessions: 2, evictionIdleGraceMS: 120_000 });
        store.addSession({ sessionId: "s1", value: makeValue("s1") });
        store.addSession({ sessionId: "s2", value: makeValue("s2") });
        vi.advanceTimersByTime(150_000);

        // Refresh s1 so only s2 is idle -> s3 evicts s2 and succeeds.
        store.getSession("s1");
        store.addSession({ sessionId: "s3", value: makeValue("s3") });

        // Now s1 (fresh) + s3 (fresh) — nothing idle past the grace -> reject.
        expect(() => store.addSession({ sessionId: "s4", value: makeValue("s4") })).toThrow(SessionLimitExceededError);
        expect(store.size).toBe(2);
    });
});
