import type { MockInstance } from "vitest";
import { describe, beforeEach, afterEach, vi, it, expect } from "vitest";
import type { LogLevel, McpServer } from "@mongodb-js/mcp-types";
import { LogId, MCP_LOG_LEVELS } from "@mongodb-js/mcp-core";
import { McpLogger } from "./mcpLogger.js";
import { LoggingMessageNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import { Keychain } from "@mongodb-js/mcp-core";

class DynamicMcpLogger extends McpLogger {
    public minimumLevel: LogLevel = "debug";

    protected override getMcpLogLevel(): LogLevel {
        return this.minimumLevel;
    }
}

describe("McpLogger", () => {
    let keychain: Keychain;
    let mcpLoggerSpy: MockInstance;
    let mcpLogger: DynamicMcpLogger;

    beforeEach(() => {
        vi.spyOn(console, "error").mockImplementation(() => {});
        keychain = Keychain.root;

        mcpLoggerSpy = vi.fn();
        mcpLogger = new DynamicMcpLogger({
            server: {
                sendLoggingMessage: mcpLoggerSpy,
                isConnected: () => true,
            } as unknown as McpServer,
            options: { logLevel: "debug" },
            keychain,
        });
    });

    afterEach(() => {
        keychain.clearAllSecrets();
        vi.restoreAllMocks();
    });

    const getLastMcpLogMessage = (): string => {
        return (mcpLoggerSpy.mock.lastCall?.[0] as { data: string }).data;
    };

    it("filters out messages below the minimum log level", () => {
        mcpLogger.minimumLevel = "debug";
        mcpLogger.log("debug", { id: LogId.serverInitialized, context: "test", message: "Debug message" });

        expect(mcpLoggerSpy).toHaveBeenCalledOnce();
        expect(getLastMcpLogMessage()).toContain("Debug message");

        mcpLogger.minimumLevel = "info";
        mcpLogger.log("debug", { id: LogId.serverInitialized, context: "test", message: "Debug message 2" });

        expect(mcpLoggerSpy).toHaveBeenCalledTimes(1);

        mcpLogger.log("alert", { id: LogId.serverInitialized, context: "test", message: "Alert message" });

        expect(mcpLoggerSpy).toHaveBeenCalledTimes(2);
        expect(getLastMcpLogMessage()).toContain("Alert message");
    });

    it("MCPLogger.LOG_LEVELS contains all possible levels", () => {
        expect(MCP_LOG_LEVELS).toEqual(LoggingMessageNotificationSchema.shape.params.shape.level.options);
    });
});
