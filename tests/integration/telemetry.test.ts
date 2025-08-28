import { Telemetry } from "../../src/telemetry/telemetry.js";
import { Session } from "../../src/common/session.js";
import { config, driverOptions } from "../../src/common/config.js";
import { DeviceId } from "../../src/helpers/deviceId.js";
import { describe, expect, it } from "vitest";
import { CompositeLogger } from "../../src/common/logger.js";
import { MCPConnectionManager } from "../../src/common/connectionManager.js";
import { ExportsManager } from "../../src/common/exportsManager.js";

describe("Telemetry", () => {
    it("should resolve the actual device ID", async () => {
        const logger = new CompositeLogger();

        const deviceId = DeviceId.create(logger);
        const actualDeviceId = await deviceId.get();

        const telemetry = Telemetry.create(
            new Session({
                apiBaseUrl: "",
                logger,
                exportsManager: ExportsManager.init(config, logger),
                connectionManager: new MCPConnectionManager(config, driverOptions, logger, deviceId),
            }),
            config,
            deviceId
        );

        expect(telemetry.getCommonProperties().device_id).toBe(undefined);
        expect(telemetry["isBufferingEvents"]).toBe(true);

        await telemetry.setupPromise;

        expect(telemetry.getCommonProperties().device_id).toBe(actualDeviceId);
        expect(telemetry["isBufferingEvents"]).toBe(false);
    });
});
