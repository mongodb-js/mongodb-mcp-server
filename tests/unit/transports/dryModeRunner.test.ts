import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DryRunModeRunner, type DryRunModeTestHelpers } from "@mongodb-mcp/transport";
import { type UserConfig } from "../../../src/common/config/userConfig.js";
import { defaultTestConfig } from "../../integration/helpers.js";
import { NullLogger } from "../../../src/common/logging/index.js";
import { DeviceId } from "../../../src/helpers/deviceId.js";
import { MockMetrics } from "../mocks/metrics.js";

describe("DryModeRunner", () => {
    let outputMock: DryRunModeTestHelpers["output"];
    const logger = new NullLogger();
    const deviceId = DeviceId.create(logger);
    const metrics = new MockMetrics();

    beforeEach(() => {
        outputMock = {
            log: vi.fn(),
            error: vi.fn(),
        };
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it.each([{ transport: "http", httpHost: "127.0.0.1", httpPort: "3001" }, { transport: "stdio" }] as Array<
        Partial<UserConfig>
    >)("should handle dry run request for transport - $transport", async (partialConfig) => {
        const userConfig = {
            ...defaultTestConfig,
            ...partialConfig,
            dryRun: true,
        };
        const runner = new DryRunModeRunner({
            userConfig,
            logger,
            deviceId,
            metrics,
            output: outputMock,
        });
        await runner.start();
        expect(outputMock.log).toHaveBeenNthCalledWith(1, "Configuration:");
        expect(outputMock.log).toHaveBeenNthCalledWith(2, JSON.stringify(userConfig, null, 2));
        expect(outputMock.log).toHaveBeenNthCalledWith(3, "Enabled tools:");
        expect(outputMock.log).toHaveBeenNthCalledWith(4, expect.stringContaining('"name": "connect"'));
        // Because switch-connection is not enabled by default
        expect(outputMock.log).toHaveBeenNthCalledWith(4, expect.not.stringContaining('"name": "switch-connection"'));

        await runner.close();
    });
});
