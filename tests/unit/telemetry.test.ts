import { ApiClient } from "../../src/common/atlas/apiClient.js";
import { Session } from "../../src/session.js";
import { Telemetry } from "../../src/telemetry/telemetry.js";
import { BaseEvent, TelemetryResult } from "../../src/telemetry/types.js";
import { EventCache } from "../../src/telemetry/eventCache.js";
import { config } from "../../src/config.js";

// Mock the ApiClient to avoid real API calls
jest.mock("../../src/common/atlas/apiClient.js");
const MockApiClient = ApiClient as jest.MockedClass<typeof ApiClient>;

// Mock EventCache to control and verify caching behavior
jest.mock("../../src/telemetry/eventCache.js");
const MockEventCache = EventCache as jest.MockedClass<typeof EventCache>;

describe("Telemetry", () => {
    let mockApiClient: jest.Mocked<ApiClient>;
    let mockEventCache: jest.Mocked<EventCache>;
    let session: Session;
    let telemetry: Telemetry;

    // Helper function to create properly typed test events
    function createTestEvent(options?: {
        source?: string;
        result?: TelemetryResult;
        component?: string;
        category?: string;
        command?: string;
        duration_ms?: number;
    }): BaseEvent {
        return {
            timestamp: new Date().toISOString(),
            source: options?.source || "mdbmcp",
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
    } = {}) {
        const { calls: sendEvents } = mockApiClient.sendEvents.mock;
        const { calls: clearEvents } = mockEventCache.clearEvents.mock;
        const { calls: appendEvents } = mockEventCache.appendEvents.mock;

        expect(sendEvents.length).toBe(sendEventsCalls);
        expect(clearEvents.length).toBe(clearEventsCalls);
        expect(appendEvents.length).toBe(appendEventsCalls);

        if (sendEventsCalledWith) {
            expect(sendEvents[0]?.[0]).toEqual(sendEventsCalledWith);
        }

        if (appendEventsCalledWith) {
            expect(appendEvents[0]?.[0]).toEqual(appendEventsCalledWith);
        }
    }

    beforeEach(() => {
        // Reset mocks before each test
        jest.clearAllMocks();

        // Setup mocked API client
        mockApiClient = new MockApiClient() as jest.Mocked<ApiClient>;
        mockApiClient.sendEvents = jest.fn().mockResolvedValue(undefined);
        mockApiClient.hasCredentials = jest.fn().mockReturnValue(true);

        // Setup mocked EventCache
        mockEventCache = new MockEventCache() as jest.Mocked<EventCache>;
        mockEventCache.getEvents = jest.fn().mockReturnValue([]);
        mockEventCache.clearEvents = jest.fn().mockResolvedValue(undefined);
        mockEventCache.appendEvents = jest.fn().mockResolvedValue(undefined);
        MockEventCache.getInstance = jest.fn().mockReturnValue(mockEventCache);

        // Create a simplified session with our mocked API client
        session = {
            apiClient: mockApiClient,
            sessionId: "test-session-id",
            agentRunner: { name: "test-agent", version: "1.0.0" } as const,
            close: jest.fn().mockResolvedValue(undefined),
            setAgentRunner: jest.fn().mockResolvedValue(undefined),
        } as unknown as Session;

        // Create the telemetry instance with mocked dependencies
        telemetry = new Telemetry(session, mockEventCache);

        config.telemetry = "enabled";
    });

    describe("when telemetry is enabled", () => {
        it("should send events successfully", async () => {
            const testEvent = createTestEvent();

            await telemetry.emitEvents([testEvent]);

            verifyMockCalls({
                sendEventsCalls: 1,
                clearEventsCalls: 1,
                sendEventsCalledWith: [testEvent],
            });
        });

        it("should cache events when sending fails", async () => {
            mockApiClient.sendEvents.mockRejectedValueOnce(new Error("API error"));

            const testEvent = createTestEvent();

            await telemetry.emitEvents([testEvent]);

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

            await telemetry.emitEvents([newEvent]);

            verifyMockCalls({
                sendEventsCalls: 1,
                clearEventsCalls: 1,
                sendEventsCalledWith: [cachedEvent, newEvent],
            });
        });
    });

    describe("when telemetry is disabled", () => {
        beforeEach(() => {
            config.telemetry = "disabled";
        });

        it("should not send events", async () => {
            const testEvent = createTestEvent();

            await telemetry.emitEvents([testEvent]);

            verifyMockCalls();
        });
    });

    it("should correctly add common properties to events", () => {
        const commonProps = telemetry.getCommonProperties();

        // Use explicit type assertion
        const expectedProps: Record<string, string> = {
            mcp_client_version: "1.0.0",
            mcp_client_name: "test-agent",
            session_id: "test-session-id",
            config_atlas_auth: "true",
            config_connection_string: expect.any(String) as unknown as string,
        };

        expect(commonProps).toMatchObject(expectedProps);
    });

    describe("when DO_NOT_TRACK environment variable is set", () => {
        let originalEnv: string | undefined;

        beforeEach(() => {
            originalEnv = process.env.DO_NOT_TRACK;
            process.env.DO_NOT_TRACK = "1";
        });

        afterEach(() => {
            process.env.DO_NOT_TRACK = originalEnv;
        });

        it("should not send events", async () => {
            const testEvent = createTestEvent();

            await telemetry.emitEvents([testEvent]);

            verifyMockCalls();
        });
    });
});
