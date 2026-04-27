import type { Keychain } from "../keychain.js";
import { type LoggerType, type LogLevel, type LogPayload, MCP_LOG_LEVELS } from "./loggingTypes.js";
import { LoggerBase } from "./loggerBase.js";

/**
 * Minimal structural interface that the McpLogger needs from a Server instance.
 *
 * We type this structurally rather than depending on the concrete `Server` class
 * to avoid a circular type dependency between the logger and the server.
 */
export interface McpLoggerServerLike {
    readonly mcpServer: {
        isConnected(): boolean;
        readonly server: {
            sendLoggingMessage(message: { level: LogLevel; data: string }): void | Promise<void>;
        };
    };
    readonly mcpLogLevel: LogLevel;
}

export class McpLogger extends LoggerBase {
    public constructor(
        private readonly server: McpLoggerServerLike,
        keychain: Keychain
    ) {
        super(keychain);
    }

    protected readonly type: LoggerType = "mcp";

    protected logCore(level: LogLevel, payload: LogPayload): void {
        // Only log if the server is connected
        if (!this.server.mcpServer.isConnected()) {
            return;
        }

        const minimumLevel = MCP_LOG_LEVELS.indexOf(this.server.mcpLogLevel);
        const currentLevel = MCP_LOG_LEVELS.indexOf(level);
        if (minimumLevel > currentLevel) {
            // Don't log if the requested level is lower than the minimum level
            return;
        }

        void this.server.mcpServer.server.sendLoggingMessage({
            level,
            data: `[${payload.context}]: ${payload.message}`,
        });
    }
}
