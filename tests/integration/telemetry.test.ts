import { DeviceId } from "../../src/helpers/deviceId.js";
import { describe, expect, it } from "vitest";
import { CompositeLogger } from "../../src/common/logging/index.js";
import { Keychain } from "../../src/common/keychain.js";
import { defaultCreateApiClient } from "../../src/common/atlas/apiClient.js";
import { Telemetry } from "../../src/telemetry/telemetry.js";

describe("Telemetry", () => {
    it("should resolve the actual device ID", async () => {
        const logger = new CompositeLogger();

        const deviceId = DeviceId.create(logger);
        const actualDeviceId = await deviceId.get();

        const telemetry = Telemetry.create({
            logger,
            deviceId,
            apiClient: defaultCreateApiClient(
                {
                    baseUrl: "https://fake.address.com/",
                },
                logger
            ),
            keychain: new Keychain(),
            enabled: true,
        });

        expect(telemetry.getCommonProperties().device_id).toBe(undefined);

        await telemetry.setupPromise;

        expect(telemetry.getCommonProperties().device_id).toBe(actualDeviceId);
    });
});
