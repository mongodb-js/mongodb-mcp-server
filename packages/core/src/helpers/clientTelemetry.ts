import type { McpServer } from "@modelcontextprotocol/server";
import type { TransportRequestContext } from "@mongodb-js/mcp-types";

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

/**
 * Reads the SDK-negotiated protocol revision off a server. Tolerates fakes and
 * mock servers that do not carry the low-level SDK server.
 */
function negotiatedProtocolVersion(mcpServer: McpServer | undefined): string | undefined {
    const server = (mcpServer as { server?: { getNegotiatedProtocolVersion?: () => string | undefined } } | undefined)
        ?.server;
    return server?.getNegotiatedProtocolVersion?.();
}

/**
 * Resolves the exact MCP protocol revision to report for a request and maps it
 * to its per-request telemetry property. Prefers the revision negotiated with
 * the client (populated on both the sessionful legacy and stateless modern
 * paths, over HTTP or stdio), falling back to the revision the transport named,
 * then to `"legacy"` when neither is known.
 */
export function protocolTelemetryProperties(
    mcpServer: McpServer | undefined,
    transportRequest?: TransportRequestContext
): { mcp_client_protocol: string } {
    return {
        mcp_client_protocol: negotiatedProtocolVersion(mcpServer) ?? transportRequest?.mcp_client_protocol ?? "legacy",
    };
}
