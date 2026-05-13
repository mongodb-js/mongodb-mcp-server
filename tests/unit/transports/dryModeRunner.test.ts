import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DryRunModeRunner, type DryRunServer } from "../../../src/transports/dryModeRunner.js";
import { type UserConfig } from "../../../src/common/config/userConfig.js";
import { defaultTestConfig } from "../../integration/helpers.js";
import { Keychain, type LoggerBase } from "@mongodb-js/mcp-core";
import { ConsoleLogger } from "@mongodb-js/mcp-logging";

describe("DryModeRunner", () => {
    let loggerMock: LoggerBase;
    let mockServer: DryRunServer;
    const logSpy = vi.fn();

    beforeEach(() => {
        logSpy.mockClear();
        loggerMock = new ConsoleLogger({
            keychain: Keychain.root,
        });
        loggerMock.log = logSpy;

        mockServer = {
            tools: [
                { name: "connect", category: "mongodb", isEnabled: (): boolean => true },
                { name: "find", category: "mongodb", isEnabled: (): boolean => true },
                { name: "aggregate", category: "mongodb", isEnabled: (): boolean => true },
                { name: "switch-connection", category: "mongodb", isEnabled: (): boolean => false },
            ],
            connect: vi.fn(() => Promise.resolve()),
            close: vi.fn(() => Promise.resolve()),
        };
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it.each([{ transport: "http", httpHost: "127.0.0.1", httpPort: "3001" }, { transport: "stdio" }] as Array<
        Partial<UserConfig>
    >)("should handle dry run request for transport - $transport", async (partialConfig) => {
        const userConfig: UserConfig = {
            ...defaultTestConfig,
            ...partialConfig,
            dryRun: true,
        };

        const runner = new DryRunModeRunner({
            logger: {
                log: logSpy,
                error: logSpy,
            },
            userConfig,
            server: mockServer,
        });

        await runner.start();

        expect(logSpy).toHaveBeenNthCalledWith(1, "Configuration:");
        expect(logSpy).toHaveBeenNthCalledWith(2, JSON.stringify(userConfig, null, 2));
        expect(logSpy).toHaveBeenNthCalledWith(3, "Enabled tools:");
        expect(logSpy).toHaveBeenNthCalledWith(4, expect.stringContaining('"name": "connect"'));
        // Because switch-connection is not enabled by default
        expect(logSpy).toHaveBeenNthCalledWith(4, expect.not.stringContaining('"name": "switch-connection"'));

        // Verify server was connected and closed
        // eslint-disable-next-line @typescript-eslint/unbound-method
        expect(mockServer.connect).toHaveBeenCalled();
        // eslint-disable-next-line @typescript-eslint/unbound-method
        expect(mockServer.close).toHaveBeenCalled();
    });
});
