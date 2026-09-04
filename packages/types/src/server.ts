import type { McpServer } from "@modelcontextprotocol/server";

/**
 * Minimum server interface required by MCPHttpServer and the stdio runner:
 * a request-scoped server instance that has been configured with tools,
 * resources, capabilities and lifecycle hooks, ready to be handed to the
 * protocol serving entry.
 *
 * The server is deliberately stateless and request-scoped: app-level services
 * (connections, exports, API clients, telemetry) live once per process and
 * are referenced by, not owned by, each request's server instance.
 */
export type BaseServer = {
    /**
     * Registers resources, capabilities, tools, request handlers and lifecycle
     * hooks on the underlying MCP server without connecting it to a transport.
     * Required by the 2026-07-28 serving entries (`serveStdio`,
     * `createMcpHandler`), which build/register instances through a factory.
     */
    register(): Promise<void>;
    /** The protocol-level MCP server handed to the serving entry. */
    mcpServer: McpServer;
};
