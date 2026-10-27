import { afterEach, beforeEach } from "vitest";

import {
    startMockTelemetryServer,
    type MockTelemetryServer,
    type ReceivedTelemetryEvent,
} from "../mocks/telemetryServer.js";

/**
 * Starts a mock telemetry endpoint in `beforeEach` and closes it in `afterEach`. The returned
 * value proxies the live server, so it can be passed to `useBinaryServer` and inspected directly.
 */
export function useMockTelemetry(): MockTelemetryServer {
    let current: MockTelemetryServer | undefined;

    const requireCurrent = (): MockTelemetryServer => {
        if (!current) {
            throw new Error("Mock telemetry server is only available during a test (started in beforeEach).");
        }
        return current;
    };

    beforeEach(async () => {
        current = await startMockTelemetryServer();
    });

    afterEach(async () => {
        await current?.close().catch(() => undefined);
        current = undefined;
    });

    return {
        get baseUrl(): string {
            return requireCurrent().baseUrl;
        },
        get received(): ReceivedTelemetryEvent[] {
            return requireCurrent().received;
        },
        waitForEvent: (predicate, timeoutMs) => requireCurrent().waitForEvent(predicate, timeoutMs),
        close: () => requireCurrent().close(),
    };
}
