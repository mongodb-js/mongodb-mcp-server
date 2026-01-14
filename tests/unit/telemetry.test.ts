import { ApiClient } from "../../src/common/atlas/apiClient.js";
import type { Session } from "../../src/common/session.js";
import { Telemetry } from "../../src/telemetry/telemetry.js";
import type { BaseEvent, CommonProperties, TelemetryEvent, TelemetryResult } from "../../src/telemetry/types.js";
import { EventCache } from "../../src/telemetry/eventCache.js";
import { afterEach, beforeEach, describe, it, vi, expect } from "vitest";
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

describe("Telemetry", () => {
    let mockApiClient: {
        sendEvents: MockedFunction<(events: BaseEvent[]) => Promise<void>>;
        validateAuthConfig: MockedFunction<() => Promise<void>>;
        isAuthConfigured: MockedFunction<() => boolean>;
    };
    let mockEventCache: {
        getEvents: MockedFunction<() => { id: number; event: BaseEvent }[]>;
        removeEvents: MockedFunction<(ids: number[]) => Promise<void>>;
        appendEvents: MockedFunction<(events: BaseEvent[]) => Promise<void>>;
    };
    let session: Session;
    let telemetry: Telemetry;
    let mockDeviceId: DeviceId;
    let config: UserConfig;

    // Helper function to create properly typed test events
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

    function emitEventsForTest(events: BaseEvent[]): Promise<void> {
        return new Promise((resolve) => {
            telemetry.events.once("events-emitted", resolve);
            telemetry.events.once("events-send-failed", resolve);
            telemetry.events.once("events-skipped", resolve);

            telemetry.emitEvents(events);
        });
    }

    // Helper function to verify mock calls to reduce duplication
    function verifyMockCalls({
        sendEventsCalls = 0,
        removeEventsCalls = 0,
        appendEventsCalls = 0,
        sendEventsCalledWith = undefined,
        appendEventsCalledWith = undefined,
    }: {
        sendEventsCalls?: number;
        removeEventsCalls?: number;
        appendEventsCalls?: number;
        sendEventsCalledWith?: BaseEvent[] | undefined;
        appendEventsCalledWith?: BaseEvent[] | undefined;
    } = {}): void {
        const { calls: sendEvents } = mockApiClient.sendEvents.mock;
        const { calls: removeEvents } = mockEventCache.removeEvents.mock;
        const { calls: appendEvents } = mockEventCache.appendEvents.mock;

        expect(sendEvents.length).toBe(sendEventsCalls);
        expect(removeEvents.length).toBe(removeEventsCalls);
        expect(appendEvents.length).toBe(appendEventsCalls);

        if (sendEventsCalledWith) {
            expect(sendEvents[0]?.[0]).toEqual(
                sendEventsCalledWith.map((event) => ({
                    ...event,
                    properties: {
                        ...telemetry.getCommonProperties(),
                        ...event.properties,
                    },
                }))
            );
        }

        if (appendEventsCalledWith) {
            expect(appendEvents[0]?.[0]).toEqual(appendEventsCalledWith);
        }
    }

    beforeEach(() => {
        config = { ...defaultTestConfig, telemetry: "enabled" };
        // Reset mocks before each test
        vi.clearAllMocks();

        // Setup mocked API client
        mockApiClient = vi.mocked(new MockApiClient({ baseUrl: "" }, new NullLogger()));

        mockApiClient.sendEvents = vi.fn().mockResolvedValue(undefined);
        mockApiClient.validateAuthConfig = vi.fn().mockReturnValue(Promise.resolve());
        mockApiClient.isAuthConfigured = vi.fn().mockReturnValue(true);

        // Setup mocked EventCache
        mockEventCache = new MockEventCache() as unknown as typeof mockEventCache;
        mockEventCache.getEvents = vi.fn().mockReturnValue([]);
        mockEventCache.removeEvents = vi.fn().mockResolvedValue(undefined);
        mockEventCache.appendEvents = vi.fn().mockResolvedValue(undefined);
        MockEventCache.getInstance = vi.fn().mockReturnValue(mockEventCache as unknown as EventCache);

        mockDeviceId = {
            get: vi.fn().mockResolvedValue("test-device-id"),
        } as unknown as DeviceId;

        // Create a simplified session with our mocked API client
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

    describe("when telemetry is enabled", () => {
        it("should send events successfully", async () => {
            const testEvent = createTestEvent();

            await telemetry.setupPromise;

            await emitEventsForTest([testEvent]);

            verifyMockCalls({
                sendEventsCalls: 1,
                removeEventsCalls: 1,
                sendEventsCalledWith: [testEvent],
            });
        });

        it("should cache events when sending fails", async () => {
            mockApiClient.sendEvents.mockRejectedValueOnce(new Error("API error"));

            const testEvent = createTestEvent();

            await telemetry.setupPromise;

            await emitEventsForTest([testEvent]);

            verifyMockCalls({
                sendEventsCalls: 1,
                appendEventsCalls: 1,
                appendEventsCalledWith: [testEvent],
            });
        });

        it("should include cached events when sending", async () => {
            const cachedEvent = createTestEvent({
                command: "cached-command",
                component: "cached-component",
            });

            const newEvent = createTestEvent({
                command: "new-command",
                component: "new-component",
            });

            // Set up mock to return cached events
            mockEventCache.getEvents.mockReturnValueOnce([{ id: 0, event: cachedEvent }]);

            await telemetry.setupPromise;

            await emitEventsForTest([newEvent]);

            verifyMockCalls({
                sendEventsCalls: 1,
                removeEventsCalls: 1,
                sendEventsCalledWith: [cachedEvent, newEvent],
            });
        });

        it("should correctly add common properties to events", async () => {
            await telemetry.setupPromise;

            const commonProps = telemetry.getCommonProperties();

            // Use explicit type assertion
            const expectedProps: Record<string, string> = {
                mcp_client_version: "1.0.0",
                mcp_client_name: "test-agent",
                session_id: "test-session-id",
                config_atlas_auth: "true",
                config_connection_string: expect.any(String) as unknown as string,
                device_id: "test-device-id",
            };

            expect(commonProps).toMatchObject(expectedProps);
        });

        it("should add hostingMode to events if set", async () => {
            telemetry = Telemetry.create(session, config, mockDeviceId, {
                eventCache: mockEventCache as unknown as EventCache,
                commonProperties: { hosting_mode: "vscode-extension" },
            });
            await telemetry.setupPromise;

            const commonProps = telemetry.getCommonProperties();
            expect(commonProps.hosting_mode).toBe("vscode-extension");

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
                const mockDeviceId = {
                    get: vi.fn().mockResolvedValue("test-device-id"),
                } as unknown as DeviceId;

                telemetry = Telemetry.create(session, config, mockDeviceId);

                expect(telemetry["isBufferingEvents"]).toBe(true);
                expect(telemetry.getCommonProperties().device_id).toBe(undefined);

                await telemetry.setupPromise;

                expect(telemetry["isBufferingEvents"]).toBe(false);
                expect(telemetry.getCommonProperties().device_id).toBe("test-device-id");
            });

            it("should handle device ID resolution failure gracefully", async () => {
                const mockDeviceId = {
                    get: vi.fn().mockResolvedValue("unknown"),
                } as unknown as DeviceId;

                telemetry = Telemetry.create(session, config, mockDeviceId);

                expect(telemetry["isBufferingEvents"]).toBe(true);
                expect(telemetry.getCommonProperties().device_id).toBe(undefined);

                await telemetry.setupPromise;

                expect(telemetry["isBufferingEvents"]).toBe(false);
                // Should use "unknown" as fallback when device ID resolution fails
                expect(telemetry.getCommonProperties().device_id).toBe("unknown");
            });

            it("should handle device ID timeout gracefully", async () => {
                const mockDeviceId = {
                    get: vi.fn().mockResolvedValue("unknown"),
                } as unknown as DeviceId;

                telemetry = Telemetry.create(session, config, mockDeviceId);

                expect(telemetry["isBufferingEvents"]).toBe(true);
                expect(telemetry.getCommonProperties().device_id).toBe(undefined);

                await telemetry.setupPromise;

                expect(telemetry["isBufferingEvents"]).toBe(false);
                // Should use "unknown" as fallback when device ID times out
                expect(telemetry.getCommonProperties().device_id).toBe("unknown");
            });
        });
    });

    describe("when telemetry is disabled", () => {
        beforeEach(() => {
            config.telemetry = "disabled";
        });

        afterEach(() => {
            config.telemetry = "enabled";
        });

        it("should not send events", async () => {
            const testEvent = createTestEvent();

            await emitEventsForTest([testEvent]);

            verifyMockCalls();
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

        it("should not send events", async () => {
            const testEvent = createTestEvent();

            await emitEventsForTest([testEvent]);

            verifyMockCalls();
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

                // Simulates sensitive data across random properties
                const sensitiveStaticProps = {
                    mcp_server_version: "secret-server-version",
                    mcp_server_name: "secret-server-name",
                    platform: "linux-secret-password",
                    arch: "x64-secret-key",
                    os_type: "linux-secret-token",
                    os_version: "secret-password-version",
                };

                telemetry = Telemetry.create(session, config, mockDeviceId, {
                    eventCache: mockEventCache as unknown as EventCache,
                    commonProperties: sensitiveStaticProps,
                });

                await telemetry.setupPromise;

                telemetry.emitEvents([createTestEvent()]);

                const calls = mockApiClient.sendEvents.mock.calls;
                expect(calls).toHaveLength(1);

                // get event properties
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

            it("should redact sensitive data from CommonProperties", () => {
                // register the common properties as sensitive data
                session.keychain.register("test-device-id", "password");
                session.keychain.register(session.sessionId, "password");

                telemetry.emitEvents([createTestEvent()]);

                const calls = mockApiClient.sendEvents.mock.calls;
                expect(calls).toHaveLength(1);

                // get event properties
                const sentEvent = calls[0]?.[0][0] as { properties: Record<string, unknown> };
                expectDefined(sentEvent);

                const eventProps = sentEvent.properties;

                expect(eventProps.device_id).toBe("<password>");
                expect(eventProps.session_id).toBe("<password>");
            });

            it("should redact sensitive data that is added to events", () => {
                session.keychain.register("test-device-id", "password");
                session.keychain.register(session.sessionId, "password");
                session.keychain.register("test-component", "password");

                telemetry.emitEvents([createTestEvent()]);

                const calls = mockApiClient.sendEvents.mock.calls;
                expect(calls).toHaveLength(1);

                // get event properties
                const sentEvent = calls[0]?.[0][0] as { properties: Record<string, unknown> };
                expectDefined(sentEvent);

                const eventProps = sentEvent.properties;
                expect(eventProps.device_id).toBe("<password>");
                expect(eventProps.session_id).toBe("<password>");
                expect(eventProps.component).toBe("<password>");
            });
        });
    });
});
