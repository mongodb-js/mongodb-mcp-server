import { describe, it, expect, vi, beforeEach } from "vitest";
import { SessionStore, type CloseableTransport } from "./sessionStore.js";
import type { LoggerBase } from "./logging/index.js";
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

describe("SessionStore metrics", () => {
    let metrics: MockMetrics;
    let logger: LoggerBase;
    let store: SessionStore;

    beforeEach(() => {
        metrics = new MockMetrics();
        logger = createMockLogger();
        store = new SessionStore({
            options: { idleTimeoutMS: 60_000, notificationTimeoutMS: 30_000 },
            logger,
            metrics,
        });
    });

    it("increments sessionCreated when a session is added", async () => {
        await store.addSession({ sessionId: "s1", transport: createMockTransport(), logger: createMockLogger() });

        const { values } = await metrics.get("sessionCreated").get();
        expect(values[0]?.value).toBe(1);
    });

    it("increments sessionCreated for each new session", async () => {
        await store.addSession({ sessionId: "s1", transport: createMockTransport(), logger: createMockLogger() });
        await store.addSession({ sessionId: "s2", transport: createMockTransport(), logger: createMockLogger() });

        const { values } = await metrics.get("sessionCreated").get();
        expect(values[0]?.value).toBe(2);
    });

    it("increments sessionClosed with reason when a session is closed", async () => {
        await store.addSession({ sessionId: "s1", transport: createMockTransport(), logger: createMockLogger() });
        await store.closeSession({ sessionId: "s1", reason: "transport_closed" });

        const { values } = await metrics.get("sessionClosed").get();
        const sample = values.find((v) => v.labels.reason === "transport_closed");
        expect(sample?.value).toBe(1);
    });

    it("records reason 'server_stop' when closeAllSessions is called", async () => {
        await store.addSession({ sessionId: "s1", transport: createMockTransport(), logger: createMockLogger() });
        await store.addSession({ sessionId: "s2", transport: createMockTransport(), logger: createMockLogger() });
        await store.closeAllSessions();

        const { values } = await metrics.get("sessionClosed").get();
        const sample = values.find((v) => v.labels.reason === "server_stop");
        expect(sample?.value).toBe(2);
    });

    it("records reason 'idle_timeout' when session times out", async () => {
        vi.useFakeTimers();
        try {
            await store.addSession({ sessionId: "s1", transport: createMockTransport(), logger: createMockLogger() });

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
        await store.addSession({ sessionId: "s1", transport: { close: closeFn }, logger: createMockLogger() });
        await store.closeSession({ sessionId: "s1", reason: "transport_closed" });

        expect(closeFn).not.toHaveBeenCalled();
    });

    it("calls transport.close() for server-initiated close reasons", async () => {
        const closeFn1 = vi.fn().mockResolvedValue(undefined);
        const closeFn2 = vi.fn().mockResolvedValue(undefined);
        await store.addSession({ sessionId: "s1", transport: { close: closeFn1 }, logger: createMockLogger() });
        await store.addSession({ sessionId: "s2", transport: { close: closeFn2 }, logger: createMockLogger() });

        await store.closeSession({ sessionId: "s1", reason: "server_stop" });
        await store.closeSession({ sessionId: "s2", reason: "idle_timeout" });

        expect(closeFn1).toHaveBeenCalledOnce();
        expect(closeFn2).toHaveBeenCalledOnce();
    });

    it("tracks separate reasons independently", async () => {
        await store.addSession({ sessionId: "s1", transport: createMockTransport(), logger: createMockLogger() });
        await store.addSession({ sessionId: "s2", transport: createMockTransport(), logger: createMockLogger() });
        await store.addSession({ sessionId: "s3", transport: createMockTransport(), logger: createMockLogger() });

        await store.closeSession({ sessionId: "s1", reason: "transport_closed" });
        await store.closeSession({ sessionId: "s2", reason: "transport_closed" });
        await store.closeSession({ sessionId: "s3", reason: "server_stop" });

        const { values } = await metrics.get("sessionClosed").get();
        expect(values.find((v) => v.labels.reason === "transport_closed")?.value).toBe(2);
        expect(values.find((v) => v.labels.reason === "server_stop")?.value).toBe(1);
    });
});
