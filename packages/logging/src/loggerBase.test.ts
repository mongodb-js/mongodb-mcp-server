import type { MockInstance } from "vitest";
import { describe, beforeEach, afterEach, vi, it, expect } from "vitest";
import type { LoggerType, LogLevel, McpServer } from "@mongodb-js/mcp-types";
import { CompositeLogger } from "@mongodb-js/mcp-core";
import { ConsoleLogger } from "./consoleLogger.js";
import { LogId } from "./logId.js";
import { McpLogger } from "./mcpLogger.js";
import { Keychain } from "@mongodb-js/mcp-core";

describe("LoggerBase redaction", () => {
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

    it("redacts sensitive information from the keychain", () => {
        keychain.register("123456", "password");
        consoleLogger.info({ id: LogId.serverInitialized, context: "test", message: "Your password is 123456." });

        expect(consoleErrorSpy).toHaveBeenCalledOnce();

        expect(getLastConsoleMessage()).to.contain("Your password is <password>");
        expect(getLastConsoleMessage()).to.not.contain("123456");
    });

    it("redacts sensitive information in attributes", () => {
        keychain.register("123456", "password");
        consoleLogger.info({
            id: LogId.serverInitialized,
            context: "test",
            message: "Safe message",
            attributes: { sessionKey: "contains 123456 value" },
        });

        expect(consoleErrorSpy).toHaveBeenCalledOnce();
        expect(getLastConsoleMessage()).to.contain("sessionKey=contains <password> value");
        expect(getLastConsoleMessage()).to.not.contain("123456");
    });

    it("redacts sensitive information from built-in patterns in attributes", () => {
        consoleLogger.info({
            id: LogId.serverInitialized,
            context: "test",
            message: "Safe message",
            attributes: { detail: "contact foo@bar.com for info" },
        });

        expect(consoleErrorSpy).toHaveBeenCalledOnce();
        expect(getLastConsoleMessage()).to.contain("detail=contact <email> for info");
        expect(getLastConsoleMessage()).to.not.contain("foo@bar.com");
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

    describe("CompositeLogger redaction", () => {
        it("propagates noRedaction config to child loggers", () => {
            const compositeLogger = new CompositeLogger({ loggers: [consoleLogger, mcpLogger] });
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
            const compositeLogger = new CompositeLogger({ loggers: [consoleLogger, mcpLogger] });
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
