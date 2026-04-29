import type { McpServer, LoggerConfig, LoggerType, LogLevel, LogPayload } from "@mongodb-js/mcp-types";
import { MCP_LOG_LEVELS } from "../index.js";
import { LoggerBase } from "./loggerBase.js";

export class McpLogger extends LoggerBase {
    private readonly server: McpServer;
    private readonly getMcpLogLevel: () => LogLevel;
    private readonly pendingSends = new Set<Promise<void>>();

    public constructor(options: { server: McpServer; mcpLogLevel: LogLevel | (() => LogLevel) } & LoggerConfig) {
        super(options);
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

        void this.dispatchLoggingMessage(level, payload);
    }

    /** Dispatches the logging message to the MCP client and keeps track of pending sends */
    private async dispatchLoggingMessage(level: LogLevel, payload: LogPayload): Promise<void> {
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

    public override async flush(): Promise<PromiseSettledResult<void>[]> {
        return Promise.allSettled([...this.pendingSends]);
    }
}
