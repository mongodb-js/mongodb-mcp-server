import type { TelemetryCommonStaticProperties } from "./types.js";
import type { ServerMetadata } from "@mongodb-js/mcp-types";

/**
 * Builds machine-specific metadata formatted for telemetry.
 * The caller provides package name/version since those are not available in this package.
 */
export function buildMachineMetadata(
    serverMetadata: Pick<ServerMetadata, "version" | "mcpServerName">
): TelemetryCommonStaticProperties {
    return {
        mcp_server_version: serverMetadata.version,
        mcp_server_name: serverMetadata.mcpServerName,
        platform: (typeof process !== "undefined" && process.platform) || "browser",
        arch: (typeof process !== "undefined" && process.arch) || "unknown",
        os_type: (typeof process !== "undefined" && process.platform) || "unknown",
        os_version: (typeof process !== "undefined" && process.version) || "unknown",
    };
}
