import type { Transport } from "@modelcontextprotocol/sdk/shared/transport";
import type { ClientCapabilities, Implementation } from "@modelcontextprotocol/sdk/types.js";
import type { ICompositeLogger } from "./logging.js";

/**
 * Minimum server interface required by MCPHttpServer.
 * Servers must have connect/close methods and a session with a logger for HTTP transport functionality.
 */
export type SessionServer<TTransport extends Transport = Transport> = {
    connect(transport: TTransport): Promise<void>;
    close(): Promise<void>;
    session: {
        logger: ICompositeLogger;
        /**
         * Optionally records the MCP client that negotiated this session's
         * initialization. Required to restore negotiated client state on
         * implicitly re-initialized sessions.
         */
        setMcpClient?(mcpClient: unknown): void;
    };
    /**
     * The protocol-level MCP server. Only present on servers that expose the
     * underlying SDK `Server`; when absent, negotiated client state cannot be
     * captured/restored across implicit re-initializations.
     */
    mcpServer?: {
        server: {
            oninitialized?: (() => void) | undefined;
            getClientCapabilities(): ClientCapabilities | undefined;
            getClientVersion(): Implementation | undefined;
        };
    };
};
