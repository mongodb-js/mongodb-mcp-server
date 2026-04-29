import type { Keychain } from "../keychain.js";
import type { LoggerType, LogLevel, LogPayload, IMcpConnection } from "@mongodb-js/mcp-types";
import { MCP_LOG_LEVELS } from "../index.js";
import { LoggerBase } from "./loggerBase.js";

export class McpLogger extends LoggerBase {
    private readonly connection: IMcpConnection;

    public constructor(options: { connection: IMcpConnection; keychain: Keychain }) {
        super({ keychain: options.keychain });
        this.connection = options.connection;
    }

    protected readonly type: LoggerType = "mcp";

    protected logCore(level: LogLevel, payload: LogPayload): void {
        if (!this.connection.isConnected()) {
            return;
        }

        const minimumLevel = MCP_LOG_LEVELS.indexOf(this.connection.mcpLogLevel);
        const currentLevel = MCP_LOG_LEVELS.indexOf(level);
        if (minimumLevel > currentLevel) {
            return;
        }

        void this.connection.sendLoggingMessage({
            level,
            data: `[${payload.context}]: ${payload.message}`,
        });
    }
}
