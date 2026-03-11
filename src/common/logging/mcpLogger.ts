import type { Server } from "../../server.js";
import type { UserConfig } from "../config/userConfig.js";
import type { Keychain } from "../keychain.js";
import type { LoggerType, LogLevel, LogPayload } from "./loggingTypes.js";
import { LoggerBase } from "./loggerBase.js";

export class McpLogger<TUserConfig extends UserConfig = UserConfig, TContext = unknown> extends LoggerBase {
    public static readonly LOG_LEVELS: LogLevel[] = [
        "debug",
        "info",
        "notice",
        "warning",
        "error",
        "critical",
        "alert",
        "emergency",
    ] as const;

    public constructor(
        private readonly server: Server<TUserConfig, TContext>,
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

        const minimumLevel = McpLogger.LOG_LEVELS.indexOf(this.server.mcpLogLevel);
        const currentLevel = McpLogger.LOG_LEVELS.indexOf(level);
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
