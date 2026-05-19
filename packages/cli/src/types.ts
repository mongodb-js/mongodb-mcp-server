import type { IMetrics, DefaultMetricDefinitions } from "@mongodb-js/mcp-types";
import type { CompositeLogger } from "@mongodb-js/mcp-core";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { UserConfig } from "./config/userConfig.js";

export type ClientInfo = {
    name: string;
    version: string;
};

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
    session: { logger: CompositeLogger };
};

export type Handler = {
    shouldHandle(config: UserConfig, args: string[]): boolean;
    handle(config: UserConfig, consoleLogger: ConsoleLogger, onExit: OnExit): Promise<void>;
};

export type CLIOptions = {
    args: string[];
    consoleLogger: ConsoleLogger;
    onExit: OnExit;
    clientInfo: ClientInfo;
    handlers?: Handler[];
    server: StartableServer;
    config: UserConfig;
    logger: CompositeLogger;
    metrics: IMetrics<DefaultMetricDefinitions>;
};
