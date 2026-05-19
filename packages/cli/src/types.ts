import type { ICompositeLogger } from "@mongodb-js/mcp-core";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

export type ConsoleLogger = {
    log(message: string): void;
    error(message: string): void;
    warn(message: string): void;
};

export type OnExit = (exitCode: number) => void;

/**
 * Generic server interface that works with any MCP transport.
 * This is compatible with both stdio and HTTP transports.
 */
export type StartableServer = {
    connect(transport: Transport): Promise<void>;
    close(): Promise<void>;
    session: { logger: ICompositeLogger };
};
