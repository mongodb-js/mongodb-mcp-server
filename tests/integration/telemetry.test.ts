import { DeviceId } from "../../src/helpers/deviceId.js";
import { describe, expect, it } from "vitest";
import { CompositeLogger } from "../../src/common/logging/index.js";
import { Keychain } from "../../src/common/keychain.js";
import { defaultTestConfig } from "./helpers.js";
import { type UserConfig } from "../../src/common/config/userConfig.js";
import { defaultCreateApiClient } from "../../src/common/atlas/apiClient.js";
import { Telemetry } from "../../src/telemetry/telemetry.js";

describe("Telemetry", () => {
    const config: UserConfig = { ...defaultTestConfig, telemetry: "enabled" };
    it("should resolve the actual device ID", async () => {
        const logger = new CompositeLogger();

        const deviceId = DeviceId.create(logger);
        const actualDeviceId = await deviceId.get();

        const telemetry = Telemetry.create({
            logger,
            deviceId,
            apiClient: defaultCreateApiClient(
                {
                    baseUrl: config.apiBaseUrl,
                },
                logger
            ),
            keychain: new Keychain(),
            enabled: false,
        });

        expect(telemetry.getCommonProperties().device_id).toBe(undefined);

        await telemetry.setupPromise;

        expect(telemetry.getCommonProperties().device_id).toBe(actualDeviceId);
    });
});
