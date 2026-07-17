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
