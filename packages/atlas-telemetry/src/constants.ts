import type { TelemetryCommonStaticProperties } from "./types.js";

/**
 * Builds machine-specific metadata formatted for telemetry.
 * The caller provides package name/version since those are not available in this package.
 */
export function buildMachineMetadata(packageName: string, packageVersion: string): TelemetryCommonStaticProperties {
    return {
        mcp_server_version: packageVersion,
        mcp_server_name: packageName,
        platform: (typeof process !== "undefined" && process.platform) || "browser",
        arch: (typeof process !== "undefined" && process.arch) || "unknown",
        os_type: (typeof process !== "undefined" && process.platform) || "unknown",
        os_version: (typeof process !== "undefined" && process.version) || "unknown",
    };
}
