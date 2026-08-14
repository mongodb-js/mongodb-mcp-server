import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DryRunModeRunner, type DryRunLogger, type DryRunServer } from "@mongodb-js/mcp-cli";
import type { UserConfig } from "@mongodb-js/mcp-cli";
import { defaultTestConfig } from "../integrationHelpers.js";

describe("DryModeRunner", () => {
    let loggerMock: DryRunLogger = { log: vi.fn(), error: vi.fn() };
    let mockServer: DryRunServer;

    beforeEach(() => {
        loggerMock = {
            log: vi.fn(),
            error: vi.fn(),
        };

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
            logger: loggerMock,
            userConfig,
            server: mockServer,
        });

        await runner.start();

        // eslint-disable-next-line @typescript-eslint/unbound-method
        expect(loggerMock.log).toHaveBeenNthCalledWith(1, "Configuration:");
        // eslint-disable-next-line @typescript-eslint/unbound-method
        expect(loggerMock.log).toHaveBeenNthCalledWith(2, JSON.stringify(userConfig, null, 2));
        // eslint-disable-next-line @typescript-eslint/unbound-method
        expect(loggerMock.log).toHaveBeenNthCalledWith(3, "Enabled tools:");
        // eslint-disable-next-line @typescript-eslint/unbound-method
        expect(loggerMock.log).toHaveBeenNthCalledWith(4, expect.stringContaining('"name": "connect"'));
        // Because switch-connection is not enabled by default
        // eslint-disable-next-line @typescript-eslint/unbound-method
        expect(loggerMock.log).toHaveBeenNthCalledWith(4, expect.not.stringContaining('"name": "switch-connection"'));

        // Verify server was connected and closed
        // eslint-disable-next-line @typescript-eslint/unbound-method
        expect(mockServer.connect).toHaveBeenCalled();
        // eslint-disable-next-line @typescript-eslint/unbound-method
        expect(mockServer.close).toHaveBeenCalled();
    });
});
