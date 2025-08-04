import { describe, beforeEach, afterEach, vi, MockInstance, it, expect } from "vitest";
import { CompositeLogger, ConsoleLogger, LoggerType, LogId, McpLogger } from "../../src/common/logger.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

describe("Logger", () => {
    let consoleErrorSpy: MockInstance<typeof console.error>;
    let consoleLogger: ConsoleLogger;

    let mcpLoggerSpy: MockInstance;
    let mcpLogger: McpLogger;

    beforeEach(() => {
        // Mock console.error before creating the ConsoleLogger
        consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

        consoleLogger = new ConsoleLogger();

        mcpLoggerSpy = vi.fn();
        mcpLogger = new McpLogger({
            server: {
                sendLoggingMessage: mcpLoggerSpy,
            },
            isConnected: () => true,
        } as unknown as McpServer);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    const getLastMcpLogMessage = (): string => {
        return (mcpLoggerSpy.mock.lastCall?.[0] as { data: string }).data;
    };

    const getLastConsoleMessage = (): string => {
        return consoleErrorSpy.mock.lastCall?.[0] as string;
    };

    const mockSensitivePayload = {
        id: LogId.serverInitialized,
        context: "test",
        message: "My email is foo@bar.com",
    };

    const expectLogMessageRedaction = (logMessage: string, expectRedacted: boolean): void => {
        const expectedContain = expectRedacted ? "<email>" : "foo@bar.com";
        const expectedNotContain = expectRedacted ? "foo@bar.com" : "<email>";

        expect(logMessage).to.contain(expectedContain);
        expect(logMessage).to.not.contain(expectedNotContain);
    };

    describe("redaction", () => {
        it("redacts sensitive information by default", () => {
            consoleLogger.info(mockSensitivePayload);

            expect(consoleErrorSpy).toHaveBeenCalledOnce();

            expectLogMessageRedaction(getLastConsoleMessage(), true);
        });

        it("does not redact sensitive information for mcp logger by default", () => {
            mcpLogger.info(mockSensitivePayload);

            expect(mcpLoggerSpy).toHaveBeenCalledOnce();

            expectLogMessageRedaction(getLastMcpLogMessage(), false);
        });

        it("allows disabling redaction for all loggers", () => {
            const payload = {
                ...mockSensitivePayload,
                noRedaction: true,
            };

            consoleLogger.debug(payload);
            mcpLogger.error(payload);

            expect(consoleErrorSpy).toHaveBeenCalledOnce();
            expectLogMessageRedaction(getLastConsoleMessage(), false);

            expect(mcpLoggerSpy).toHaveBeenCalledOnce();
            expectLogMessageRedaction(getLastMcpLogMessage(), false);
        });

        it("allows forcing redaction for all loggers", () => {
            const payload = {
                ...mockSensitivePayload,
                noRedaction: false,
            };

            consoleLogger.warning(payload);
            mcpLogger.warning(payload);

            expect(consoleErrorSpy).toHaveBeenCalledOnce();
            expectLogMessageRedaction(getLastConsoleMessage(), true);

            expect(mcpLoggerSpy).toHaveBeenCalledOnce();
            expectLogMessageRedaction(getLastMcpLogMessage(), true);
        });

        it("allows disabling redaction for specific loggers", () => {
            const payload = {
                ...mockSensitivePayload,
                noRedaction: "console" as LoggerType,
            };

            consoleLogger.debug(payload);
            mcpLogger.debug(payload);

            expect(consoleErrorSpy).toHaveBeenCalledOnce();
            expectLogMessageRedaction(getLastConsoleMessage(), false);

            expect(mcpLoggerSpy).toHaveBeenCalledOnce();
            expectLogMessageRedaction(getLastMcpLogMessage(), true);
        });

        it("allows disabling redaction for multiple loggers", () => {
            const payload = {
                ...mockSensitivePayload,
                noRedaction: ["console", "mcp"] as LoggerType[],
            };

            consoleLogger.notice(payload);
            mcpLogger.notice(payload);

            expect(consoleErrorSpy).toHaveBeenCalledOnce();
            expectLogMessageRedaction(getLastConsoleMessage(), false);

            expect(mcpLoggerSpy).toHaveBeenCalledOnce();
            expectLogMessageRedaction(getLastMcpLogMessage(), false);
        });

        describe("CompositeLogger", () => {
            it("propagates noRedaction config to child loggers", () => {
                const compositeLogger = new CompositeLogger(consoleLogger, mcpLogger);
                compositeLogger.info({
                    ...mockSensitivePayload,
                    noRedaction: true,
                });

                expect(consoleErrorSpy).toHaveBeenCalledOnce();
                expectLogMessageRedaction(getLastConsoleMessage(), false);

                expect(mcpLoggerSpy).toHaveBeenCalledOnce();
                expectLogMessageRedaction(getLastMcpLogMessage(), false);
            });

            it("supports redaction for a subset of its child loggers", () => {
                const compositeLogger = new CompositeLogger(consoleLogger, mcpLogger);
                compositeLogger.info({
                    ...mockSensitivePayload,
                    noRedaction: ["console", "disk"],
                });

                expect(consoleErrorSpy).toHaveBeenCalledOnce();
                expectLogMessageRedaction(getLastConsoleMessage(), false);

                expect(mcpLoggerSpy).toHaveBeenCalledOnce();
                expectLogMessageRedaction(getLastMcpLogMessage(), true);
            });
        });
    });
});
