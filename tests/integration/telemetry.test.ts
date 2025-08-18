import { Telemetry } from "../../src/telemetry/telemetry.js";
import { Session } from "../../src/common/session.js";
import { config } from "../../src/common/config.js";
import { DeviceIdService } from "../../src/helpers/deviceId.js";
import { describe, expect, it } from "vitest";
import { CompositeLogger } from "../../src/common/logger.js";
import { ConnectionManager } from "../../src/common/connectionManager.js";
import { ExportsManager } from "../../src/common/exportsManager.js";
import nodeMachineId from "node-machine-id";

describe("Telemetry", () => {
    it("should resolve the actual device ID", async () => {
        const logger = new CompositeLogger();

        // Initialize DeviceIdService like the main application does
        DeviceIdService.init(logger, () => nodeMachineId.machineId(true));

        const actualDeviceId = await DeviceIdService.getInstance().getDeviceId();

        const telemetry = Telemetry.create(
            new Session({
                apiBaseUrl: "",
                logger: new CompositeLogger(),
                exportsManager: ExportsManager.init(config, logger),
                connectionManager: new ConnectionManager(),
            }),
            config
        );

        expect(telemetry.getCommonProperties().device_id).toBe(undefined);
        expect(telemetry["isBufferingEvents"]).toBe(true);

        await telemetry.setupPromise;

        expect(telemetry.getCommonProperties().device_id).toBe(actualDeviceId);
        expect(telemetry["isBufferingEvents"]).toBe(false);
    });
});
