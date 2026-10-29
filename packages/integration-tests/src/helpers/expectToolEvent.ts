import { packageInfo } from "mongodb-mcp-server";
import { expect } from "vitest";

import type { ReceivedTelemetryEvent } from "../mocks/telemetryServer.js";
import { DEFAULT_CLIENT_NAME, DEFAULT_CLIENT_VERSION } from "./connectClient.js";

/** Property keys the server stamps on every tool event in the stdio setup. */
const TOOL_EVENT_KEYS = [
    "arch",
    "category",
    "command",
    "component",
    "device_id",
    "duration_ms",
    "is_container_env",
    "mcp_client_name",
    "mcp_client_protocol",
    "mcp_client_version",
    "mcp_server_name",
    "mcp_server_version",
    "os_type",
    "os_version",
    "platform",
    "result",
];

export type ToolEventExpectation = {
    command: string;
    result: "success" | "failure";
    /** The machine's actual device id, resolved the same way the server resolves it. */
    deviceId: string;
    /** Property keys this tool event adds beyond {@link TOOL_EVENT_KEYS}. */
    extraKeys?: string[];
};

/** Asserts the full envelope and common-property shape of a tool telemetry event. */
export function expectToolEvent(event: ReceivedTelemetryEvent, expected: ToolEventExpectation): void {
    const { command, result, deviceId, extraKeys = [] } = expected;

    expect(Object.keys(event).sort()).toEqual(["properties", "source", "timestamp"]);
    expect(event.source).toBe("mdbmcp");
    expect(new Date(event.timestamp).toISOString()).toBe(event.timestamp);

    expect(event.properties).toMatchObject({
        component: "tool",
        command,
        category: "mongodb",
        result,
        mcp_server_name: packageInfo.mcpServerName,
        mcp_server_version: packageInfo.version,
        platform: process.platform,
        arch: process.arch,
        os_type: process.platform,
        os_version: process.version,
        device_id: deviceId,
        mcp_client_name: DEFAULT_CLIENT_NAME,
        mcp_client_version: DEFAULT_CLIENT_VERSION,
    });
    expect(Object.keys(event.properties).sort()).toEqual([...TOOL_EVENT_KEYS, ...extraKeys].sort());
    expect(event.properties.is_container_env).toMatch(/^(true|false)$/);
    expect(event.properties.mcp_client_protocol).toMatch(/^(legacy|\d{4}-\d{2}-\d{2})$/);
    expect(Number.isInteger(event.properties.duration_ms)).toBe(true);
    expect(event.properties.duration_ms).toBeGreaterThanOrEqual(0);
}
