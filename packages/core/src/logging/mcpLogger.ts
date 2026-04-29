import type { Keychain } from "../keychain.js";
import type { McpServer, LoggerType, LogLevel, LogPayload } from "@mongodb-js/mcp-types";
import { MCP_LOG_LEVELS } from "../index.js";
import { LoggerBase } from "./loggerBase.js";

export class McpLogger extends LoggerBase {
    private readonly server: McpServer;
    private readonly getMcpLogLevel: () => LogLevel;
    private readonly pendingSends = new Set<Promise<void>>();

    public constructor(options: { server: McpServer; mcpLogLevel: LogLevel | (() => LogLevel); keychain: Keychain }) {
        super({ keychain: options.keychain });
        this.server = options.server;
        this.getMcpLogLevel =
            typeof options.mcpLogLevel === "function"
                ? options.mcpLogLevel
                : (): LogLevel => options.mcpLogLevel as LogLevel;
    }

    protected readonly type: LoggerType = "mcp";

    protected logCore(level: LogLevel, payload: LogPayload): void {
        if (!this.server.isConnected()) {
            return;
        }

        const minimumLevel = MCP_LOG_LEVELS.indexOf(this.getMcpLogLevel());
        const currentLevel = MCP_LOG_LEVELS.indexOf(level);
        if (minimumLevel > currentLevel) {
            return;
        }

        void this.trackSend(level, payload);
    }

    private async trackSend(level: LogLevel, payload: LogPayload): Promise<void> {
        const promise: Promise<void> = this.server.sendLoggingMessage({
            level,
            data: `[${payload.context}]: ${payload.message}`,
        });
        this.pendingSends.add(promise);
        try {
            await promise;
        } catch {
            // Swallow send failures — same as the original fire-and-forget behavior
        } finally {
            this.pendingSends.delete(promise);
        }
    }

    public override async flush(): Promise<void> {
        await Promise.allSettled([...this.pendingSends]);
    }
}
