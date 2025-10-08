import { Telemetry } from "../../src/telemetry/telemetry.js";
import { Session } from "../../src/common/session.js";
import { config } from "../../src/common/config.js";
import { driverOptions } from "./helpers.js";
import { DeviceId } from "../../src/helpers/deviceId.js";
import { describe, expect, it } from "vitest";
import { CompositeLogger } from "../../src/common/logger.js";
import { MCPConnectionManager } from "../../src/common/connectionManager.js";
import { ExportsManager } from "../../src/common/exportsManager.js";
import { Keychain } from "../../src/common/keychain.js";

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
                keychain: new Keychain(),
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

    it("should redact sensitive data", async () => {
        const logger = new CompositeLogger();
        const deviceId = DeviceId.create(logger);

        // configure keychain with a secret that would show up in random properties
        const keychain = new Keychain();
        keychain.register(process.platform, "url");

        const telemetry = Telemetry.create(
            new Session({
                apiBaseUrl: "",
                logger,
                exportsManager: ExportsManager.init(config, logger),
                connectionManager: new MCPConnectionManager(config, driverOptions, logger, deviceId),
                keychain: keychain,
            }),
            config,
            deviceId
        );

        await telemetry.setupPromise;

        // expect the platform to be redacted
        const commonProperties = telemetry.getCommonProperties();
        expect(commonProperties.platform).toBe("<url>");
        expect(telemetry["isBufferingEvents"]).toBe(false);
    });
});
