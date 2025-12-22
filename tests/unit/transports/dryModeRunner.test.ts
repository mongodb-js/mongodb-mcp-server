import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DryRunModeRunner, type DryRunModeTestHelpers } from "../../../src/transports/dryModeRunner.js";
import { type UserConfig } from "../../../src/common/config/userConfig.js";
import { type TransportRunnerConfig } from "../../../src/transports/base.js";
import { defaultTestConfig } from "../../integration/helpers.js";

describe("DryModeRunner", () => {
    let loggerMock: DryRunModeTestHelpers["logger"];
    let runnerConfig: TransportRunnerConfig;

    beforeEach(() => {
        loggerMock = {
            log: vi.fn(),
            error: vi.fn(),
        };
        runnerConfig = {
            userConfig: defaultTestConfig,
        } as TransportRunnerConfig;
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it.each([{ transport: "http", httpHost: "127.0.0.1", httpPort: "3001" }, { transport: "stdio" }] as Array<
        Partial<UserConfig>
    >)("should handle dry run request for transport - $transport", async (partialConfig) => {
        runnerConfig.userConfig = {
            ...runnerConfig.userConfig,
            ...partialConfig,
            dryRun: true,
        };
        const runner = new DryRunModeRunner({ logger: loggerMock, ...runnerConfig });
        await runner.start();
        expect(loggerMock.log).toHaveBeenNthCalledWith(1, "Configuration:");
        expect(loggerMock.log).toHaveBeenNthCalledWith(2, JSON.stringify(runnerConfig.userConfig, null, 2));
        expect(loggerMock.log).toHaveBeenNthCalledWith(3, "Enabled tools:");
        expect(loggerMock.log).toHaveBeenNthCalledWith(4, expect.stringContaining('"name": "connect"'));
        // Because switch-connection is not enabled by default
        expect(loggerMock.log).toHaveBeenNthCalledWith(4, expect.not.stringContaining('"name": "switch-connection"'));
    });
});
