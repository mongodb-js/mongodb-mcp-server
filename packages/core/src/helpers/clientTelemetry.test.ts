import { describe, expect, it } from "vitest";
import { clientTelemetryProperties } from "./clientTelemetry.js";

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
