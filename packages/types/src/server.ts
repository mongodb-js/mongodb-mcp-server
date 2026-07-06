import type { Transport } from "@modelcontextprotocol/sdk/shared/transport";
import type { ICompositeLogger } from "./logging.js";

/**
 * Minimum server interface required by MCPHttpServer.
 * Servers must have connect/close methods and a session with a logger for HTTP transport functionality.
 */
export type SessionServer<TTransport extends Transport = Transport> = {
    connect(transport: TTransport): Promise<void>;
    close(): Promise<void>;
    session: { logger: ICompositeLogger };
};
