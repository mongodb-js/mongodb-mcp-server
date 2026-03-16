import { describe, it, expect, vi, beforeEach } from "vitest";
import { SessionStore, type CloseableTransport } from "../../src/common/sessionStore.js";
import type { LoggerBase } from "../../src/common/logging/index.js";
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
        store = new SessionStore(60_000, 30_000, logger, metrics);
    });

    it("increments sessionCreated when a session is added", async () => {
        store.setSession("s1", createMockTransport(), createMockLogger());

        const { values } = await metrics.get("sessionCreated").get();
        expect(values[0]?.value).toBe(1);
    });

    it("increments sessionCreated for each new session", async () => {
        store.setSession("s1", createMockTransport(), createMockLogger());
        store.setSession("s2", createMockTransport(), createMockLogger());

        const { values } = await metrics.get("sessionCreated").get();
        expect(values[0]?.value).toBe(2);
    });

    it("increments sessionClosed with reason when a session is closed", async () => {
        store.setSession("s1", createMockTransport(), createMockLogger());
        await store.closeSession({ sessionId: "s1", reason: "transport_closed" });

        const { values } = await metrics.get("sessionClosed").get();
        const sample = values.find((v) => v.labels.reason === "transport_closed");
        expect(sample?.value).toBe(1);
    });

    it("records reason 'server_stop' when closeAllSessions is called", async () => {
        store.setSession("s1", createMockTransport(), createMockLogger());
        store.setSession("s2", createMockTransport(), createMockLogger());
        await store.closeAllSessions();

        const { values } = await metrics.get("sessionClosed").get();
        const sample = values.find((v) => v.labels.reason === "server_stop");
        expect(sample?.value).toBe(2);
    });

    it("records reason 'idle_timeout' when session times out", async () => {
        vi.useFakeTimers();
        try {
            store.setSession("s1", createMockTransport(), createMockLogger());

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
        store.setSession("s1", { close: closeFn }, createMockLogger());
        await store.closeSession({ sessionId: "s1", reason: "transport_closed" });

        expect(closeFn).not.toHaveBeenCalled();
    });

    it("calls transport.close() for server-initiated close reasons", async () => {
        const closeFn1 = vi.fn().mockResolvedValue(undefined);
        const closeFn2 = vi.fn().mockResolvedValue(undefined);
        store.setSession("s1", { close: closeFn1 }, createMockLogger());
        store.setSession("s2", { close: closeFn2 }, createMockLogger());

        await store.closeSession({ sessionId: "s1", reason: "server_stop" });
        await store.closeSession({ sessionId: "s2", reason: "idle_timeout" });

        expect(closeFn1).toHaveBeenCalledOnce();
        expect(closeFn2).toHaveBeenCalledOnce();
    });

    it("tracks separate reasons independently", async () => {
        store.setSession("s1", createMockTransport(), createMockLogger());
        store.setSession("s2", createMockTransport(), createMockLogger());
        store.setSession("s3", createMockTransport(), createMockLogger());

        await store.closeSession({ sessionId: "s1", reason: "transport_closed" });
        await store.closeSession({ sessionId: "s2", reason: "transport_closed" });
        await store.closeSession({ sessionId: "s3", reason: "server_stop" });

        const { values } = await metrics.get("sessionClosed").get();
        expect(values.find((v) => v.labels.reason === "transport_closed")?.value).toBe(2);
        expect(values.find((v) => v.labels.reason === "server_stop")?.value).toBe(1);
    });
});
