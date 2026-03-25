import { ApiClient } from "../../src/common/atlas/apiClient.js";
import { ApiClientError } from "../../src/common/atlas/apiClientError.js";
import type { Session } from "../../src/common/session.js";
import {
    Telemetry,
    nextBackoffMs,
    BATCH_SIZE,
    SEND_INTERVAL_MS,
    INITIAL_BACKOFF_MS,
    MAX_BACKOFF_MS,
} from "../../src/telemetry/telemetry.js";
import type { BaseEvent, CommonProperties, TelemetryEvent, TelemetryResult } from "../../src/telemetry/types.js";
import { EventCache } from "../../src/telemetry/eventCache.js";
import { afterEach, beforeAll, beforeEach, describe, it, vi, expect } from "vitest";
import { NullLogger } from "../../tests/utils/index.js";
import type { MockedFunction } from "vitest";
import type { DeviceId } from "../../src/helpers/deviceId.js";
import { defaultTestConfig, expectDefined } from "../integration/helpers.js";
import { Keychain } from "../../src/common/keychain.js";
import { type UserConfig } from "../../src/common/config/userConfig.js";

// Mock the ApiClient to avoid real API calls
vi.mock("../../src/common/atlas/apiClient.js");
const MockApiClient = vi.mocked(ApiClient);

// Mock EventCache to control and verify caching behavior
vi.mock("../../src/telemetry/eventCache.js");
const MockEventCache = vi.mocked(EventCache);

// Mock container detection to avoid file I/O in tests
vi.mock("../../src/helpers/container.js", () => ({
    detectContainerEnv: vi.fn().mockResolvedValue(false),
}));

describe("nextBackoffMs", () => {
    it("should double the current backoff", () => {
        expect(nextBackoffMs(60_000)).toBe(120_000);
        expect(nextBackoffMs(120_000)).toBe(240_000);
    });

    it("should cap at MAX_BACKOFF_MS", () => {
        expect(nextBackoffMs(MAX_BACKOFF_MS)).toBe(MAX_BACKOFF_MS);
        expect(nextBackoffMs(MAX_BACKOFF_MS / 2 + 1)).toBe(MAX_BACKOFF_MS);
    });
});

describe("Telemetry", () => {
    let mockApiClient: {
        sendEvents: MockedFunction<(events: BaseEvent[], options?: { signal?: AbortSignal }) => Promise<void>>;
        validateAuthConfig: MockedFunction<() => Promise<void>>;
        isAuthConfigured: MockedFunction<() => boolean>;
    };
    let mockEventCache: {
        size: number;
        getEvents: MockedFunction<() => { id: number; event: BaseEvent }[]>;
        removeEvents: MockedFunction<(ids: number[]) => void>;
        appendEvents: MockedFunction<(events: BaseEvent[]) => void>;
        processOldestBatch: MockedFunction<
            <T>(
                batchSize: number,
                processor: (events: BaseEvent[]) => Promise<{ removeProcessed: boolean; result: T }>
            ) => Promise<T | undefined>
        >;
    };
    let session: Session;
    let telemetry: Telemetry;
    let mockDeviceId: DeviceId;
    let config: UserConfig;

    // In-memory store backing the stateful mock EventCache
    let _cachedEvents: BaseEvent[] = [];

    function createTestEvent(options?: {
        result?: TelemetryResult;
        component?: string;
        category?: string;
        command?: string;
        duration_ms?: number;
    }): Omit<BaseEvent, "properties"> & {
        properties: {
            component: string;
            duration_ms: number;
            result: TelemetryResult;
            category: string;
            command: string;
        };
    } {
        return {
            timestamp: new Date().toISOString(),
            source: "mdbmcp",
            properties: {
                component: options?.component || "test-component",
                duration_ms: options?.duration_ms || 100,
                result: options?.result || "success",
                category: options?.category || "test",
                command: options?.command || "test-command",
            },
        };
    }

    /**
     * Emits events and advances fake timers to trigger the send timer.
     * Returns once the telemetry emits an outcome event.
     */
    async function emitEventsForTest(events: BaseEvent[]): Promise<void> {
        const eventFired = new Promise<void>((resolve) => {
            telemetry.events.once("events-emitted", resolve);
            telemetry.events.once("events-send-failed", resolve);
            telemetry.events.once("events-skipped", resolve);
        });

        telemetry.emitEvents(events);
        await vi.advanceTimersByTimeAsync(SEND_INTERVAL_MS);
        return eventFired;
    }

    function createRateLimitedError(): ApiClientError {
        return ApiClientError.fromError(
            { status: 429, statusText: "Too Many Requests" } as Response,
            "Too Many Requests"
        );
    }

    beforeEach(() => {
        vi.useFakeTimers();
        _cachedEvents = [];
        config = { ...defaultTestConfig, telemetry: "enabled" };
        vi.clearAllMocks();

        // Setup mocked API client
        mockApiClient = vi.mocked(new MockApiClient({ baseUrl: "" }, new NullLogger()));
        mockApiClient.sendEvents = vi.fn().mockResolvedValue(undefined);
        mockApiClient.validateAuthConfig = vi.fn().mockReturnValue(Promise.resolve());
        mockApiClient.isAuthConfigured = vi.fn().mockReturnValue(true);

        // Setup a stateful mocked EventCache backed by _cachedEvents
        mockEventCache = new MockEventCache() as unknown as typeof mockEventCache;
        Object.defineProperty(mockEventCache, "size", { get: () => _cachedEvents.length, configurable: true });
        mockEventCache.getEvents = vi.fn().mockImplementation(() => _cachedEvents.map((event, id) => ({ id, event })));
        mockEventCache.removeEvents = vi.fn().mockImplementation((ids: number[]) => {
            _cachedEvents = _cachedEvents.filter((_, i) => !ids.includes(i));
        });
        mockEventCache.appendEvents = vi.fn().mockImplementation((events: BaseEvent[]) => {
            _cachedEvents.push(...events);
        });
        mockEventCache.processOldestBatch = vi
            .fn()
            .mockImplementation(
                async <T>(
                    batchSize: number,
                    processor: (events: BaseEvent[]) => Promise<{ removeProcessed: boolean; result: T }>
                ): Promise<T | undefined> => {
                    const allEvents = mockEventCache.getEvents();
                    const batch = allEvents.slice(0, batchSize);
                    if (batch.length === 0) return undefined;

                    const { removeProcessed, result } = await processor(batch.map((e) => e.event));
                    if (removeProcessed) {
                        mockEventCache.removeEvents(batch.map((e) => e.id));
                    }
                    return result;
                }
            );
        MockEventCache.getInstance = vi.fn().mockReturnValue(mockEventCache as unknown as EventCache);

        mockDeviceId = {
            get: vi.fn().mockResolvedValue("test-device-id"),
        } as unknown as DeviceId;

        session = {
            apiClient: mockApiClient as unknown as ApiClient,
            sessionId: "test-session-id",
            agentRunner: { name: "test-agent", version: "1.0.0" } as const,
            mcpClient: { name: "test-agent", version: "1.0.0" },
            close: vi.fn().mockResolvedValue(undefined),
            setAgentRunner: vi.fn().mockResolvedValue(undefined),
            logger: new NullLogger(),
            keychain: new Keychain(),
        } as unknown as Session;

        telemetry = Telemetry.create(session, config, mockDeviceId, {
            eventCache: mockEventCache as unknown as EventCache,
        });

        config.telemetry = "enabled";
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    describe("when telemetry is enabled", () => {
        it("should not send immediately on emitEvents — only after the timer fires", async () => {
            const testEvent = createTestEvent();
            await telemetry.setupPromise;

            telemetry.emitEvents([testEvent]);

            expect(mockApiClient.sendEvents).not.toHaveBeenCalled();
            expect(mockEventCache.appendEvents).toHaveBeenCalledWith([testEvent]);

            await vi.advanceTimersByTimeAsync(SEND_INTERVAL_MS);

            expect(mockApiClient.sendEvents).toHaveBeenCalledTimes(1);
        });

        it("should send events successfully and remove them from cache", async () => {
            const testEvent = createTestEvent();
            await telemetry.setupPromise;

            await emitEventsForTest([testEvent]);

            expect(mockApiClient.sendEvents).toHaveBeenCalledTimes(1);
            expect(mockEventCache.removeEvents).toHaveBeenCalledTimes(1);
            expect(_cachedEvents).toHaveLength(0);
        });

        it("should leave events in cache when sending fails", async () => {
            mockApiClient.sendEvents.mockRejectedValueOnce(new Error("API error"));
            const testEvent = createTestEvent();
            await telemetry.setupPromise;

            await emitEventsForTest([testEvent]);

            expect(mockApiClient.sendEvents).toHaveBeenCalledTimes(1);
            // processOldestBatch does NOT remove on failure — events stay
            expect(mockEventCache.removeEvents).not.toHaveBeenCalled();
            expect(_cachedEvents).toHaveLength(1);
        });

        it("should include previously cached events when sending", async () => {
            const cachedEvent = createTestEvent({ command: "cached-command", component: "cached-component" });
            const newEvent = createTestEvent({ command: "new-command", component: "new-component" });

            // Pre-populate the cache
            _cachedEvents.push(cachedEvent);

            await telemetry.setupPromise;
            await emitEventsForTest([newEvent]);

            expect(mockApiClient.sendEvents).toHaveBeenCalledTimes(1);
            const sentEvents = mockApiClient.sendEvents.mock.calls[0]?.[0];
            expect(sentEvents).toHaveLength(2);
        });

        it("should send at most BATCH_SIZE events per timer tick", async () => {
            const events = Array.from({ length: BATCH_SIZE + 5 }, (_, i) => createTestEvent({ command: `event-${i}` }));
            _cachedEvents.push(...events);

            await telemetry.setupPromise;

            const eventFired = new Promise<void>((resolve) => {
                telemetry.events.once("events-emitted", resolve);
            });
            await vi.advanceTimersByTimeAsync(SEND_INTERVAL_MS);
            await eventFired;

            const sentEvents = mockApiClient.sendEvents.mock.calls[0]?.[0];
            expect(sentEvents).toHaveLength(BATCH_SIZE);
            expect(_cachedEvents).toHaveLength(5);
        });

        it("should correctly add common properties to events", async () => {
            await telemetry.setupPromise;

            const commonProps = telemetry.getCommonProperties();

            expect(commonProps).toMatchObject({
                mcp_client_version: "1.0.0",
                mcp_client_name: "test-agent",
                session_id: "test-session-id",
                config_atlas_auth: "true",
                device_id: "test-device-id",
            });
        });

        it("should add hostingMode to events if set", async () => {
            vi.clearAllTimers();
            telemetry = Telemetry.create(session, config, mockDeviceId, {
                eventCache: mockEventCache as unknown as EventCache,
                commonProperties: { hosting_mode: "vscode-extension" },
            });
            await telemetry.setupPromise;

            expect(telemetry.getCommonProperties().hosting_mode).toBe("vscode-extension");

            await emitEventsForTest([createTestEvent()]);

            const calls = mockApiClient.sendEvents.mock.calls;
            expect(calls).toHaveLength(1);
            const event = calls[0]?.[0][0];
            expectDefined(event);
            expect((event as TelemetryEvent<CommonProperties>).properties.hosting_mode).toBe("vscode-extension");
        });

        describe("device ID resolution", () => {
            beforeEach(() => {
                vi.clearAllMocks();
            });

            afterEach(() => {
                vi.clearAllMocks();
            });

            it("should successfully resolve the device ID", async () => {
                vi.clearAllTimers();
                const devId = { get: vi.fn().mockResolvedValue("test-device-id") } as unknown as DeviceId;
                telemetry = Telemetry.create(session, config, devId);

                expect(telemetry["isBufferingEvents"]).toBe(true);
                expect(telemetry.getCommonProperties().device_id).toBe(undefined);

                await telemetry.setupPromise;

                expect(telemetry["isBufferingEvents"]).toBe(false);
                expect(telemetry.getCommonProperties().device_id).toBe("test-device-id");
            });

            it("should handle device ID resolution failure gracefully", async () => {
                vi.clearAllTimers();
                const devId = { get: vi.fn().mockResolvedValue("unknown") } as unknown as DeviceId;
                telemetry = Telemetry.create(session, config, devId);

                expect(telemetry["isBufferingEvents"]).toBe(true);
                await telemetry.setupPromise;

                expect(telemetry["isBufferingEvents"]).toBe(false);
                expect(telemetry.getCommonProperties().device_id).toBe("unknown");
            });

            it("should handle device ID timeout gracefully", async () => {
                vi.clearAllTimers();
                const devId = { get: vi.fn().mockResolvedValue("unknown") } as unknown as DeviceId;
                telemetry = Telemetry.create(session, config, devId);

                expect(telemetry["isBufferingEvents"]).toBe(true);
                await telemetry.setupPromise;

                expect(telemetry["isBufferingEvents"]).toBe(false);
                expect(telemetry.getCommonProperties().device_id).toBe("unknown");
            });
        });
    });

    describe("rate limiting and backoff", () => {
        it("should stop the normal send timer when receiving a 429", async () => {
            mockApiClient.sendEvents.mockRejectedValueOnce(createRateLimitedError());
            await telemetry.setupPromise;

            await emitEventsForTest([createTestEvent()]);

            // The next send should be delayed by INITIAL_BACKOFF_MS, not SEND_INTERVAL_MS
            vi.clearAllMocks();
            _cachedEvents.push(createTestEvent());
            await vi.advanceTimersByTimeAsync(SEND_INTERVAL_MS);
            expect(mockApiClient.sendEvents).not.toHaveBeenCalled();
        });

        it("should retry after the backoff delay", async () => {
            mockApiClient.sendEvents.mockRejectedValueOnce(createRateLimitedError());
            await telemetry.setupPromise;

            await emitEventsForTest([createTestEvent()]);

            vi.clearAllMocks();
            _cachedEvents.push(createTestEvent());
            // Advance past the backoff delay — the timer should fire and send
            await vi.advanceTimersByTimeAsync(INITIAL_BACKOFF_MS);
            expect(mockApiClient.sendEvents).toHaveBeenCalledTimes(1);
        });

        it("should double the backoff on consecutive 429s", async () => {
            await telemetry.setupPromise;
            expect(telemetry["backoffMs"]).toBe(INITIAL_BACKOFF_MS);

            // First 429
            mockApiClient.sendEvents.mockRejectedValueOnce(createRateLimitedError());
            await emitEventsForTest([createTestEvent()]);
            expect(telemetry["backoffMs"]).toBe(INITIAL_BACKOFF_MS * 2);

            // Second 429
            mockApiClient.sendEvents.mockRejectedValueOnce(createRateLimitedError());
            _cachedEvents.push(createTestEvent());
            await vi.advanceTimersByTimeAsync(INITIAL_BACKOFF_MS);
            expect(telemetry["backoffMs"]).toBe(INITIAL_BACKOFF_MS * 4);
        });

        it("should cap backoff at MAX_BACKOFF_MS", async () => {
            await telemetry.setupPromise;
            telemetry["backoffMs"] = MAX_BACKOFF_MS;

            mockApiClient.sendEvents.mockRejectedValueOnce(createRateLimitedError());
            await emitEventsForTest([createTestEvent()]);

            expect(telemetry["backoffMs"]).toBe(MAX_BACKOFF_MS);
        });

        it("should reset backoff after a successful send", async () => {
            await telemetry.setupPromise;
            telemetry["backoffMs"] = MAX_BACKOFF_MS;

            await emitEventsForTest([createTestEvent()]);

            expect(telemetry["backoffMs"]).toBe(INITIAL_BACKOFF_MS);
        });

        it("should not apply backoff for non-429 errors", async () => {
            mockApiClient.sendEvents.mockRejectedValueOnce(new Error("Network error"));
            await telemetry.setupPromise;

            await emitEventsForTest([createTestEvent()]);

            // The next send should fire at the normal interval, not a backoff delay
            vi.clearAllMocks();
            _cachedEvents.push(createTestEvent());
            await vi.advanceTimersByTimeAsync(SEND_INTERVAL_MS);
            expect(mockApiClient.sendEvents).toHaveBeenCalledTimes(1);
        });
    });

    describe("when telemetry is disabled", () => {
        beforeEach(() => {
            config.telemetry = "disabled";
        });

        afterEach(() => {
            config.telemetry = "enabled";
        });

        it("should not send or cache events", async () => {
            const testEvent = createTestEvent();

            await emitEventsForTest([testEvent]);

            expect(mockApiClient.sendEvents).not.toHaveBeenCalled();
            expect(mockEventCache.appendEvents).not.toHaveBeenCalled();
        });
    });

    describe("when DO_NOT_TRACK environment variable is set", () => {
        let originalEnv: string | undefined;

        beforeEach(() => {
            originalEnv = process.env.DO_NOT_TRACK;
            process.env.DO_NOT_TRACK = "1";
        });

        afterEach(() => {
            if (originalEnv) {
                process.env.DO_NOT_TRACK = originalEnv;
            } else {
                delete process.env.DO_NOT_TRACK;
            }
        });

        it("should not send or cache events", async () => {
            const testEvent = createTestEvent();

            await emitEventsForTest([testEvent]);

            expect(mockApiClient.sendEvents).not.toHaveBeenCalled();
            expect(mockEventCache.appendEvents).not.toHaveBeenCalled();
        });
    });

    describe("when secrets are registered", () => {
        describe("comprehensive redaction coverage", () => {
            it("should redact sensitive data from CommonStaticProperties", async () => {
                session.keychain.register("secret-server-version", "password");
                session.keychain.register("secret-server-name", "password");
                session.keychain.register("secret-password", "password");
                session.keychain.register("secret-key", "password");
                session.keychain.register("secret-token", "password");
                session.keychain.register("secret-password-version", "password");

                const sensitiveStaticProps = {
                    mcp_server_version: "secret-server-version",
                    mcp_server_name: "secret-server-name",
                    platform: "linux-secret-password",
                    arch: "x64-secret-key",
                    os_type: "linux-secret-token",
                    os_version: "secret-password-version",
                };

                vi.clearAllTimers();
                telemetry = Telemetry.create(session, config, mockDeviceId, {
                    eventCache: mockEventCache as unknown as EventCache,
                    commonProperties: sensitiveStaticProps,
                });
                await telemetry.setupPromise;

                await emitEventsForTest([createTestEvent()]);

                const calls = mockApiClient.sendEvents.mock.calls;
                expect(calls).toHaveLength(1);

                const sentEvent = calls[0]?.[0][0] as { properties: Record<string, unknown> };
                expectDefined(sentEvent);

                const eventProps = sentEvent.properties;
                expect(eventProps.mcp_server_version).toBe("<password>");
                expect(eventProps.mcp_server_name).toBe("<password>");
                expect(eventProps.platform).toBe("linux-<password>");
                expect(eventProps.arch).toBe("x64-<password>");
                expect(eventProps.os_type).toBe("linux-<password>");
                expect(eventProps.os_version).toBe("<password>-version");
            });

            it("should redact sensitive data from CommonProperties", async () => {
                session.keychain.register("test-device-id", "password");
                session.keychain.register(session.sessionId, "password");

                await telemetry.setupPromise;
                await emitEventsForTest([createTestEvent()]);

                const calls = mockApiClient.sendEvents.mock.calls;
                expect(calls).toHaveLength(1);

                const sentEvent = calls[0]?.[0][0] as { properties: Record<string, unknown> };
                expectDefined(sentEvent);

                expect(sentEvent.properties.device_id).toBe("<password>");
                expect(sentEvent.properties.session_id).toBe("<password>");
            });

            it("should redact sensitive data that is added to events", async () => {
                session.keychain.register("test-device-id", "password");
                session.keychain.register(session.sessionId, "password");
                session.keychain.register("test-component", "password");

                await telemetry.setupPromise;
                await emitEventsForTest([createTestEvent()]);

                const calls = mockApiClient.sendEvents.mock.calls;
                expect(calls).toHaveLength(1);

                const sentEvent = calls[0]?.[0][0] as { properties: Record<string, unknown> };
                expectDefined(sentEvent);

                expect(sentEvent.properties.device_id).toBe("<password>");
                expect(sentEvent.properties.session_id).toBe("<password>");
                expect(sentEvent.properties.component).toBe("<password>");
            });
        });
    });

    describe("close", () => {
        it("should send one final batch on close", async () => {
            await telemetry.setupPromise;
            _cachedEvents.push(createTestEvent());

            await telemetry.close();

            expect(mockApiClient.sendEvents).toHaveBeenCalledTimes(1);
            expect(_cachedEvents).toHaveLength(0);
        });

        it("should complete within the timeout even if sendBatch hangs", async () => {
            await telemetry.setupPromise;
            _cachedEvents.push(createTestEvent());

            // Make sendEvents hang forever
            mockApiClient.sendEvents.mockImplementation(() => new Promise(() => {}));

            const closePromise = telemetry.close();
            // Advance past the close timeout
            await vi.advanceTimersByTimeAsync(10_000);
            await closePromise;

            // close() completed — events remain since the send never resolved
            expect(_cachedEvents).toHaveLength(1);
        });
    });

    /**
     * Regression test: the processOldestBatch exclusive lock prevents the same events
     * from being sent twice when sendBatch is triggered concurrently.
     */
    describe("when sendBatch is triggered concurrently", () => {
        let RealEventCache: typeof EventCache;

        beforeAll(async () => {
            const mod = await vi.importActual<{ EventCache: typeof EventCache }>("../../src/telemetry/eventCache.js");
            RealEventCache = mod.EventCache;
        });

        it("should not send the same cached event twice when two batches overlap", async () => {
            const eventCache = new RealEventCache();
            const CACHED_MARKER = "cached-race-test";

            eventCache.appendEvents([createTestEvent({ command: CACHED_MARKER, component: "cached" })]);

            mockApiClient.sendEvents.mockResolvedValue(undefined);

            vi.clearAllTimers();
            const raceTelemetry = Telemetry.create(session, config, mockDeviceId, {
                eventCache,
            });
            await raceTelemetry.setupPromise;

            await Promise.all([raceTelemetry["sendBatch"](), raceTelemetry["sendBatch"]()]);

            let cachedEventSendCount = 0;
            for (const call of mockApiClient.sendEvents.mock.calls) {
                const events = call[0] as Array<{ properties?: { command?: string } }>;
                for (const e of events) {
                    if (e.properties?.command === CACHED_MARKER) cachedEventSendCount++;
                }
            }
            expect(cachedEventSendCount, "Cached event should be sent exactly once").toBe(1);
        });
    });
});
