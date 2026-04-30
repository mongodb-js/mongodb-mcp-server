import type { MockInstance } from "vitest";
import { describe, beforeEach, afterEach, vi, it, expect } from "vitest";
import type { LogLevel, McpServer } from "@mongodb-js/mcp-types";
import { CompositeLogger } from "@mongodb-js/mcp-core";
import { ConsoleLogger } from "./consoleLogger.js";
import { LogId } from "./logId.js";
import { McpLogger } from "./mcpLogger.js";
import { Keychain } from "@mongodb-js/mcp-core";

describe("CompositeLogger", () => {
    let consoleErrorSpy: MockInstance<typeof console.error>;
    let consoleLogger: ConsoleLogger;
    let keychain: Keychain;

    let mcpLoggerSpy: MockInstance;
    let mcpLogger: McpLogger;

    beforeEach(() => {
        consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
        keychain = Keychain.root;

        consoleLogger = new ConsoleLogger({ keychain });

        mcpLoggerSpy = vi.fn();
        mcpLogger = new McpLogger({
            server: {
                sendLoggingMessage: mcpLoggerSpy,
                isConnected: () => true,
            } as unknown as McpServer,
            mcpLogLevel: (): LogLevel => "debug",
            keychain,
        });
    });

    afterEach(() => {
        keychain.clearAllSecrets();
        vi.restoreAllMocks();
    });

    const getLastConsoleMessage = (): string => {
        return consoleErrorSpy.mock.lastCall?.[0] as string;
    };

    const getLastMcpLogMessage = (): string => {
        return (mcpLoggerSpy.mock.lastCall?.[0] as { data: string }).data;
    };

    describe("with attributes", () => {
        it("propagates attributes to child loggers", () => {
            const compositeLogger = new CompositeLogger({ loggers: [consoleLogger, mcpLogger] });
            compositeLogger.setAttribute("foo", "bar");

            compositeLogger.info({
                id: LogId.serverInitialized,
                context: "test",
                message: "Test message with attributes",
            });

            expect(consoleErrorSpy).toHaveBeenCalledOnce();
            expect(getLastConsoleMessage()).toContain("foo=bar");

            expect(mcpLoggerSpy).toHaveBeenCalledOnce();
            expect(getLastMcpLogMessage()).not.toContain("foo=bar");
        });

        it("merges attributes with payload attributes", () => {
            const compositeLogger = new CompositeLogger({ loggers: [consoleLogger, mcpLogger] });
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
            expect(getLastMcpLogMessage()).not.toContain("foo=bar");
            expect(getLastMcpLogMessage()).not.toContain("baz=qux");
        });

        it("doesn't impact base logger's attributes", () => {
            const childComposite = new CompositeLogger({ loggers: [consoleLogger] });
            const attributedComposite = new CompositeLogger({ loggers: [consoleLogger, childComposite] });
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
