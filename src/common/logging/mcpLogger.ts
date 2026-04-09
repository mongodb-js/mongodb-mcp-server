import type { Server } from "../../server.js";
import type { Keychain } from "../keychain.js";
import { type LoggerType, type LogLevel, type LogPayload, MCP_LOG_LEVELS } from "./loggingTypes.js";
import { LoggerBase } from "./loggerBase.js";

export class McpLogger extends LoggerBase {
    public constructor(
        private readonly server: Server,
        keychain: Keychain
    ) {
        super(keychain);
    }

    protected readonly type: LoggerType = "mcp";

    protected logCore(level: LogLevel, payload: LogPayload): void {
        if (!this.server.mcpServer.isConnected()) {
            return;
        }

        const minimumLevel = MCP_LOG_LEVELS.indexOf(this.server.mcpLogLevel);
        const currentLevel = MCP_LOG_LEVELS.indexOf(level);
        if (minimumLevel > currentLevel) {
            return;
        }

        void this.server.mcpServer.server.sendLoggingMessage({
            level,
            data: `[${payload.context}]: ${payload.message}`,
        });
    }
}
