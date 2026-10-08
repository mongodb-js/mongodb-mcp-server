import { describe, expect, it } from "vitest";
import type { McpServer } from "@modelcontextprotocol/server";
import { clientTelemetryProperties, protocolTelemetryProperties } from "./clientTelemetry.js";

describe("clientTelemetryProperties", () => {
    it("maps a declared name and version to the per-request telemetry fields", () => {
        expect(clientTelemetryProperties({ name: "claude-code", version: "1.2.3" })).toEqual({
            mcp_client_name: "claude-code",
            mcp_client_version: "1.2.3",
        });
    });

    it("omits fields that were not declared rather than sending undefined", () => {
        expect(clientTelemetryProperties({ name: "claude-code" })).toEqual({ mcp_client_name: "claude-code" });
        expect(clientTelemetryProperties({ version: "1.2.3" })).toEqual({ mcp_client_version: "1.2.3" });
    });

    it("returns no fields when there is no client identity at all", () => {
        expect(clientTelemetryProperties(undefined)).toEqual({});
        expect(clientTelemetryProperties({})).toEqual({});
    });

    it('emits the normalized "unknown" fallback as-is (consistent with the connection appName)', () => {
        expect(clientTelemetryProperties({ name: "unknown", version: "unknown" })).toEqual({
            mcp_client_name: "unknown",
            mcp_client_version: "unknown",
        });
    });
});

describe("protocolTelemetryProperties", () => {
    function fakeServer(negotiated?: string): McpServer {
        return { server: { getNegotiatedProtocolVersion: () => negotiated } } as unknown as McpServer;
    }

    it("prefers the SDK-negotiated revision", () => {
        expect(protocolTelemetryProperties(fakeServer("2025-11-25"), { mcp_client_protocol: "2024-11-05" })).toEqual({
            mcp_client_protocol: "2025-11-25",
        });
    });

    it("falls back to the transport-named revision when there is no negotiated one", () => {
        expect(protocolTelemetryProperties(fakeServer(undefined), { mcp_client_protocol: "2025-06-18" })).toEqual({
            mcp_client_protocol: "2025-06-18",
        });
    });

    it('falls back to "legacy" when neither is known', () => {
        expect(protocolTelemetryProperties(undefined, undefined)).toEqual({ mcp_client_protocol: "legacy" });
        expect(protocolTelemetryProperties(fakeServer(undefined), {})).toEqual({ mcp_client_protocol: "legacy" });
    });

    it("tolerates fakes without the low-level SDK server", () => {
        expect(protocolTelemetryProperties({} as McpServer)).toEqual({ mcp_client_protocol: "legacy" });
    });
});
