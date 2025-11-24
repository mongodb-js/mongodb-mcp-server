import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DryModeRunner, type DryModeTestHelpers } from "../../../src/transports/dryModeRunner.js";
import { type UserConfig } from "../../../src/common/config/userConfig.js";
import { type TransportRunnerConfig } from "../../../src/transports/base.js";
import { defaultTestConfig } from "../../integration/helpers.js";

describe("DryModeRunner", () => {
    let exitMock: DryModeTestHelpers["exit"];
    let loggerMock: DryModeTestHelpers["logger"];
    let runnerConfig: TransportRunnerConfig;

    beforeEach(() => {
        exitMock = vi.fn<DryModeTestHelpers["exit"]>();
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

    it("should not do anything if dry mode is disabled", async () => {
        await DryModeRunner.assertDryMode(runnerConfig, exitMock, loggerMock);
        expect(exitMock).not.toHaveBeenCalled();
        expect(loggerMock.log).not.toHaveBeenCalled();
    });

    it.each([{ transport: "http", httpHost: "127.0.0.1", httpPort: "3001" }, { transport: "stdio" }] as Array<
        Partial<UserConfig>
    >)("should run in dry mode if enabled for transport - $transport", async (partialConfig) => {
        runnerConfig.userConfig = {
            ...runnerConfig.userConfig,
            ...partialConfig,
            dry: true,
        };
        await DryModeRunner.assertDryMode(runnerConfig, exitMock, loggerMock);
        expect(exitMock).toHaveBeenCalledWith(0);
        expect(loggerMock.log).toHaveBeenNthCalledWith(1, "Configuration:");
        expect(loggerMock.log).toHaveBeenNthCalledWith(2, JSON.stringify(runnerConfig.userConfig, null, 2));
        expect(loggerMock.log).toHaveBeenNthCalledWith(3, "Enabled tools:");
        expect(loggerMock.log).toHaveBeenNthCalledWith(4, expect.stringContaining('"name": "connect"'));
    });
});
