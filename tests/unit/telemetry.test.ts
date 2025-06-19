import { ApiClient } from "../../src/common/atlas/apiClient.js";
import { Session } from "../../src/session.js";
import { Telemetry } from "../../src/telemetry/telemetry.js";
import { BaseEvent, TelemetryResult } from "../../src/telemetry/types.js";
import { EventCache } from "../../src/telemetry/eventCache.js";
import { config } from "../../src/config.js";
import { jest } from "@jest/globals";
import logger, { LogId } from "../../src/logger.js";
import { createHmac } from "crypto";

// Mock the ApiClient to avoid real API calls
jest.mock("../../src/common/atlas/apiClient.js");
const MockApiClient = ApiClient as jest.MockedClass<typeof ApiClient>;

// Mock EventCache to control and verify caching behavior
jest.mock("../../src/telemetry/eventCache.js");
const MockEventCache = EventCache as jest.MockedClass<typeof EventCache>;

const nextTick = () => new Promise((resolve) => process.nextTick(resolve));

describe("Telemetry", () => {
    const machineId = "test-machine-id";
    const hashedMachineId = createHmac("sha256", machineId.toUpperCase()).update("atlascli").digest("hex");

    let mockApiClient: jest.Mocked<ApiClient>;
    let mockEventCache: jest.Mocked<EventCache>;
    let session: Session;
    let telemetry: Telemetry;
    let telemetryConfig: {
        eventCache: EventCache;
        getRawMachineId: () => Promise<string>;
        getContainerEnv: () => Promise<boolean>;
    };

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

    // Helper function to verify mock calls to reduce duplication
    function verifyMockCalls({
        sendEventsCalls = 0,
        clearEventsCalls = 0,
        appendEventsCalls = 0,
        sendEventsCalledWith = undefined,
        appendEventsCalledWith = undefined,
    }: {
        sendEventsCalls?: number;
        clearEventsCalls?: number;
        appendEventsCalls?: number;
        sendEventsCalledWith?: BaseEvent[] | undefined;
        appendEventsCalledWith?: BaseEvent[] | undefined;
    } = {}) {
        const { calls: sendEvents } = mockApiClient.sendEvents.mock;
        const { calls: clearEvents } = mockEventCache.clearEvents.mock;
        const { calls: appendEvents } = mockEventCache.appendEvents.mock;

        expect(sendEvents.length).toBe(sendEventsCalls);
        expect(clearEvents.length).toBe(clearEventsCalls);
        expect(appendEvents.length).toBe(appendEventsCalls);

        if (sendEventsCalledWith) {
            expect(sendEvents[0]?.[0]).toMatchObject(sendEventsCalledWith);
        }

        if (appendEventsCalledWith) {
            expect(appendEvents[0]?.[0]).toMatchObject(appendEventsCalledWith);
        }
    }

    beforeEach(() => {
        // Reset mocks before each test
        jest.clearAllMocks();

        // Setup mocked API client
        mockApiClient = new MockApiClient({ baseUrl: "" }) as jest.Mocked<ApiClient>;
        //@ts-expect-error This is a workaround
        mockApiClient.sendEvents = jest.fn<() => undefined>().mockResolvedValue(undefined);
        mockApiClient.hasCredentials = jest.fn<() => boolean>().mockReturnValue(true);

        // Setup mocked EventCache
        mockEventCache = new MockEventCache() as jest.Mocked<EventCache>;
        //@ts-expect-error This is a workaround
        mockEventCache.getEvents = jest.fn().mockReturnValue([]);
        //@ts-expect-error This is a workaround
        mockEventCache.clearEvents = jest.fn().mockResolvedValue(undefined);
        //@ts-expect-error This is a workaround
        mockEventCache.appendEvents = jest.fn().mockResolvedValue(undefined);
        //@ts-expect-error This is a workaround
        MockEventCache.getInstance = jest.fn().mockReturnValue(mockEventCache);

        // Create a simplified session with our mocked API client
        session = {
            apiClient: mockApiClient,
            sessionId: "test-session-id",
            agentRunner: { name: "test-agent", version: "1.0.0" } as const,
            //@ts-expect-error This is a workaround
            close: jest.fn().mockResolvedValue(undefined),
            //@ts-expect-error This is a workaround
            setAgentRunner: jest.fn().mockResolvedValue(undefined),
        } as unknown as Session;

        telemetryConfig = {
            eventCache: mockEventCache,
            getRawMachineId: () => Promise.resolve(machineId),
            getContainerEnv: () => Promise.resolve(false),
        };

        telemetry = Telemetry.create(session, config, telemetryConfig);

        config.telemetry = "enabled";
    });

    describe("sending events", () => {
        describe("when telemetry is enabled", () => {
            it("should send events successfully", async () => {
                const testEvent = createTestEvent();

                telemetry.emitEvents([testEvent]);
                await nextTick(); // wait for the event to be sent

                verifyMockCalls({
                    sendEventsCalls: 1,
                    clearEventsCalls: 1,
                    sendEventsCalledWith: [testEvent],
                });
            });

            it("should cache events when sending fails", async () => {
                mockApiClient.sendEvents.mockRejectedValueOnce(new Error("API error"));

                const testEvent = createTestEvent();

                telemetry.emitEvents([testEvent]);
                await nextTick(); // wait for the event to be sent

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
                mockEventCache.getEvents.mockReturnValueOnce([cachedEvent]);

                telemetry.emitEvents([newEvent]);
                await nextTick(); // wait for the event to be sent

                verifyMockCalls({
                    sendEventsCalls: 1,
                    clearEventsCalls: 1,
                    sendEventsCalledWith: [cachedEvent, newEvent],
                });
            });

            it("should correctly add common properties to events", async () => {
                // Use explicit type assertion
                const expectedProps: Record<string, string> = {
                    mcp_client_version: "1.0.0",
                    mcp_client_name: "test-agent",
                    session_id: "test-session-id",
                    config_atlas_auth: "true",
                    config_connection_string: expect.any(String) as unknown as string,
                    device_id: hashedMachineId,
                };

                const testEvent = createTestEvent();

                telemetry.emitEvents([testEvent]);
                await nextTick(); // wait for the event to be sent

                const checkEvent = {
                    ...testEvent,
                    properties: {
                        ...testEvent.properties,
                        ...expectedProps,
                    },
                };

                verifyMockCalls({
                    sendEventsCalls: 1,
                    clearEventsCalls: 1,
                    sendEventsCalledWith: [checkEvent],
                });
            });

            it("should send cache new event while sending another event", async () => {
                const newEvent = createTestEvent({
                    command: "new-command",
                    component: "new-component",
                });

                const newEvent2 = createTestEvent({
                    command: "new-command-2",
                    component: "new-component-2",
                });

                telemetry.emitEvents([newEvent]);
                telemetry.emitEvents([newEvent2]);

                await nextTick(); // wait for the event to be sent

                verifyMockCalls({
                    sendEventsCalls: 1,
                    clearEventsCalls: 1,
                    appendEventsCalls: 1,
                    sendEventsCalledWith: [newEvent],
                    appendEventsCalledWith: [newEvent2],
                });
            });

            describe("machine ID resolution", () => {
                it("should successfully resolve the machine ID", async () => {
                    const testEvent = createTestEvent();

                    telemetry.emitEvents([testEvent]);
                    await nextTick(); // wait for the event to be sent

                    const checkEvent = {
                        ...testEvent,
                        properties: {
                            ...testEvent.properties,
                            device_id: hashedMachineId,
                        },
                    };

                    verifyMockCalls({
                        sendEventsCalls: 1,
                        clearEventsCalls: 1,
                        sendEventsCalledWith: [checkEvent],
                    });
                });

                it("should handle machine ID resolution failure", async () => {
                    const loggerSpy = jest.spyOn(logger, "debug");

                    telemetry = Telemetry.create(session, config, {
                        ...telemetryConfig,
                        getRawMachineId: () => Promise.reject(new Error("Failed to get device ID")),
                    });

                    const testEvent = createTestEvent();

                    telemetry.emitEvents([testEvent]);

                    await nextTick(); // wait for the event to be sent

                    expect(loggerSpy).toHaveBeenCalledWith(
                        LogId.telemetryDeviceIdFailure,
                        "telemetry",
                        "Error: Failed to get device ID"
                    );
                });

                it("should timeout if machine ID resolution takes too long", () => {
                    const loggerSpy = jest.spyOn(logger, "debug");

                    jest.useFakeTimers();

                    telemetry = Telemetry.create(session, config, {
                        ...telemetryConfig,
                        getRawMachineId: () => new Promise(() => {}), // Never resolves
                    });

                    const testEvent = createTestEvent();

                    telemetry.emitEvents([testEvent]);

                    jest.advanceTimersByTime(5000);

                    jest.useRealTimers();

                    expect(loggerSpy).toHaveBeenCalledTimes(2);

                    expect(loggerSpy).toHaveBeenNthCalledWith(
                        2,
                        LogId.telemetryDeviceIdTimeout,
                        "telemetry",
                        "Device ID retrieval timed out"
                    );
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

                telemetry.emitEvents([testEvent]);
                await nextTick(); // wait for the event to be sent

                verifyMockCalls({
                    sendEventsCalls: 0,
                });
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

                telemetry.emitEvents([testEvent]);
                await nextTick(); // wait for the event to be sent

                verifyMockCalls({
                    sendEventsCalls: 0,
                });
            });
        });
    });
});
