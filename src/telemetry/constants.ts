import { packageInfo } from "../common/packageInfo.js";
import { type CommonStaticProperties } from "./types.js";

/**
 * Machine-specific metadata formatted for telemetry
 */
export const MACHINE_METADATA: CommonStaticProperties = {
    mcp_server_version: packageInfo.version,
    mcp_server_name: packageInfo.mcpServerName,
    platform: (typeof process !== "undefined" && process.platform) || "browser",
    arch: (typeof process !== "undefined" && process.arch) || "unknown",
    os_type: (typeof process !== "undefined" && process.platform) || "unknown",
    os_version: (typeof process !== "undefined" && process.version) || "unknown",
} as const;
