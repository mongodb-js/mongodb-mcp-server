/**
 * Maps a resolved client identity to the per-request telemetry properties
 * `mcp_client_name` / `mcp_client_version`.
 *
 * These are declared as {@link TelemetryCommonProperties} but carry per-request
 * (per-client) identity, so they attach to each event rather than to the shared
 * pipeline. A field is only present when its value was declared — absent
 * entirely otherwise, never `undefined`. An undeclared name surfaces as
 * `"unknown"`, matching the fallback the connection appName uses.
 */
export function clientTelemetryProperties(
    clientInfo:
        | {
              name?: string;
              version?: string;
          }
        | undefined
): { mcp_client_name?: string; mcp_client_version?: string } {
    if (!clientInfo) {
        return {};
    }
    return {
        ...(clientInfo.name !== undefined ? { mcp_client_name: clientInfo.name } : {}),
        ...(clientInfo.version !== undefined ? { mcp_client_version: clientInfo.version } : {}),
    };
}
