import type { MockInstance } from "vitest";
import { describe, beforeEach, afterEach, vi, it, expect } from "vitest";
import type { LoggerType, LogLevel } from "../../src/common/logger.js";
import { CompositeLogger, ConsoleLogger, DiskLogger, LogId, McpLogger } from "../../src/common/logger.js";
import os from "os";
import * as path from "path";
import * as fs from "fs/promises";
import { once } from "events";
import type { Server } from "../../src/server.js";
import { LoggingMessageNotificationSchema } from "@modelcontextprotocol/sdk/types.js";

describe("Logger", () => {
    let consoleErrorSpy: MockInstance<typeof console.error>;
    let consoleLogger: ConsoleLogger;

    let mcpLoggerSpy: MockInstance;
    let mcpLogger: McpLogger;
    let minimumMcpLogLevel: LogLevel;

    beforeEach(() => {
        // Mock console.error before creating the ConsoleLogger
        consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

        consoleLogger = new ConsoleLogger();

        mcpLoggerSpy = vi.fn();
        minimumMcpLogLevel = "debug";
        mcpLogger = new McpLogger({
            mcpServer: {
                server: {
                    sendLoggingMessage: mcpLoggerSpy,
                },
                isConnected: () => true,
            },
            get mcpLogLevel() {
                return minimumMcpLogLevel;
            },
        } as unknown as Server);
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

    describe("disk logger", () => {
        let logPath: string;
        beforeEach(() => {
            logPath = path.join(os.tmpdir(), `mcp-logs-test-${Math.random()}-${Date.now()}`);
        });

        const assertNoLogs: () => Promise<void> = async () => {
            try {
                const files = await fs.readdir(logPath);
                expect(files.length).toBe(0);
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } catch (err: any) {
                // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
                if (err?.code !== "ENOENT") {
                    throw err;
                }
            }
        };

        it("buffers messages during initialization", async () => {
            const diskLogger = new DiskLogger(logPath, (err) => {
                expect.fail(`Disk logger should not fail to initialize: ${err}`);
            });

            diskLogger.info({ id: LogId.serverInitialized, context: "test", message: "Test message" });
            await assertNoLogs();

            await once(diskLogger, "initialized");

            const files = await fs.readdir(logPath);
            expect(files.length).toBe(1);
            const logContent = await fs.readFile(path.join(logPath, files[0] as string), "utf-8");
            expect(logContent).toContain("Test message");
        });

        it("includes attributes in the logs", async () => {
            const diskLogger = new DiskLogger(logPath, (err) => {
                expect.fail(`Disk logger should not fail to initialize: ${err}`);
            });

            diskLogger.info({
                id: LogId.serverInitialized,
                context: "test",
                message: "Test message",
                attributes: { foo: "bar" },
            });
            await assertNoLogs();

            await once(diskLogger, "initialized");

            const files = await fs.readdir(logPath);
            expect(files.length).toBe(1);
            const logContent = await fs.readFile(path.join(logPath, files[0] as string), "utf-8");
            expect(logContent).toContain("Test message");
            expect(logContent).toContain('"foo":"bar"');
        });
    });

    describe("CompositeLogger", () => {
        describe("with attributes", () => {
            it("propagates attributes to child loggers", () => {
                const compositeLogger = new CompositeLogger(consoleLogger, mcpLogger);
                compositeLogger.setAttribute("foo", "bar");

                compositeLogger.info({
                    id: LogId.serverInitialized,
                    context: "test",
                    message: "Test message with attributes",
                });

                expect(consoleErrorSpy).toHaveBeenCalledOnce();
                expect(getLastConsoleMessage()).toContain("foo=bar");

                expect(mcpLoggerSpy).toHaveBeenCalledOnce();
                // The MCP logger ignores attributes
                expect(getLastMcpLogMessage()).not.toContain("foo=bar");
            });

            it("merges attributes with payload attributes", () => {
                const compositeLogger = new CompositeLogger(consoleLogger, mcpLogger);
                compositeLogger.setAttribute("foo", "bar");

                compositeLogger.info({
                    id: LogId.serverInitialized,
                    context: "test",
                    message: "Test message with attributes",
                    attributes: { baz: "qux" },
                });

                expect(consoleErrorSpy).toHaveBeenCalledOnce();
                expect(getLastConsoleMessage()).toContain("foo=bar");
                expect(getLastConsoleMessage()).toContain("baz=qux");

                expect(mcpLoggerSpy).toHaveBeenCalledOnce();
                // The MCP logger ignores attributes
                expect(getLastMcpLogMessage()).not.toContain("foo=bar");
                expect(getLastMcpLogMessage()).not.toContain("baz=qux");
            });

            it("doesn't impact base logger's attributes", () => {
                const childComposite = new CompositeLogger(consoleLogger);
                const attributedComposite = new CompositeLogger(consoleLogger, childComposite);
                attributedComposite.setAttribute("foo", "bar");

                attributedComposite.info({
                    id: LogId.serverInitialized,
                    context: "test",
                    message: "Test message with attributes",
                });

                // We include the console logger twice - once in the attributedComposite
                // and another time in the childComposite, so we expect to have 2 console.error
                // calls.
                expect(consoleErrorSpy).toHaveBeenCalledTimes(2);
                expect(getLastConsoleMessage()).toContain("foo=bar");

                // The base logger should not have the attribute set
                consoleLogger.debug({
                    id: LogId.serverInitialized,
                    context: "test",
                    message: "Another message without attributes",
                });

                expect(consoleErrorSpy).toHaveBeenCalledTimes(3);
                expect(getLastConsoleMessage()).not.toContain("foo=bar");

                // The child composite should not have the attribute set
                childComposite.error({
                    id: LogId.serverInitialized,
                    context: "test",
                    message: "Another message without attributes",
                });

                expect(consoleErrorSpy).toHaveBeenCalledTimes(4);
                expect(getLastConsoleMessage()).not.toContain("foo=bar");
            });
        });
    });

    describe("mcp logger", () => {
        it("filters out messages below the minimum log level", () => {
            minimumMcpLogLevel = "debug";
            mcpLogger.log("debug", { id: LogId.serverInitialized, context: "test", message: "Debug message" });

            expect(mcpLoggerSpy).toHaveBeenCalledOnce();
            expect(getLastMcpLogMessage()).toContain("Debug message");

            minimumMcpLogLevel = "info";
            mcpLogger.log("debug", { id: LogId.serverInitialized, context: "test", message: "Debug message 2" });

            expect(mcpLoggerSpy).toHaveBeenCalledTimes(1);

            mcpLogger.log("alert", { id: LogId.serverInitialized, context: "test", message: "Alert message" });

            expect(mcpLoggerSpy).toHaveBeenCalledTimes(2);
            expect(getLastMcpLogMessage()).toContain("Alert message");
        });

        it("MCPLogger.LOG_LEVELS contains all possible levels", () => {
            expect(McpLogger.LOG_LEVELS).toEqual(LoggingMessageNotificationSchema.shape.params.shape.level.options);
        });
    });
});
