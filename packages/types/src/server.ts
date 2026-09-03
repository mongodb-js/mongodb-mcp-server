import type { Transport, McpServer } from "@modelcontextprotocol/server";
import type { ICompositeLogger } from "./logging.js";

/**
 * Minimum server interface required by MCPHttpServer.
 * Servers must have connect/close methods, a session with a logger (and a
 * `setMcpClient` hook) for HTTP transport functionality, and expose the
 * protocol-level MCP server so negotiated client state can be captured and
 * restored across implicit re-initializations.
 */
export type SessionServer<TTransport extends Transport = Transport> = {
    connect(transport: TTransport): Promise<void>;
    /**
     * Registers resources, capabilities, tools, request handlers and lifecycle
     * hooks on the underlying MCP server without connecting it to a transport.
     * Required by the 2026-07-28 serving entries (`serveStdio`,
     * `createMcpHandler`), which build/register instances through a factory.
     */
    register(): Promise<void>;
    close(): Promise<void>;
    session: {
        logger: ICompositeLogger;
        /**
         * Records the MCP client that negotiated this session's
         * initialization. Required to restore negotiated client state on
         * implicitly re-initialized sessions.
         */
        setMcpClient(mcpClient: unknown): void;
    };
    /**
     * The protocol-level MCP server, required to capture/restore negotiated
     * client state across implicit re-initializations.
     */
    mcpServer: McpServer;
};
