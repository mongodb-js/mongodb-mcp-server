import type { MockTelemetryServer, ReceivedTelemetryEvent } from "@mongodb-js/mcp-test-utils";

// Telemetry is batched and sent on a timer (or on server close), so allow at least one interval.
export const TELEMETRY_EVENT_TIMEOUT_MS = 45_000;

/** Waits for a tool telemetry event delivered to the mock telemetry server. */
export function waitForToolTelemetryEvent(
    telemetry: MockTelemetryServer,
    { command, result = "success" }: { command: string; result?: "success" | "failure" }
): Promise<ReceivedTelemetryEvent> {
    return telemetry.waitForEvent(
        (event) =>
            event.properties.component === "tool" &&
            event.properties.command === command &&
            event.properties.result === result,
        TELEMETRY_EVENT_TIMEOUT_MS
    );
}
