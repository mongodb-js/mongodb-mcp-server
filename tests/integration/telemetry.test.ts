import { DeviceId } from "../../src/helpers/deviceId.js";
import { describe, expect, it } from "vitest";
import { CompositeLogger } from "@mongodb-js/mcp-core";
import { Keychain } from "@mongodb-js/mcp-core";
import { ApiClient } from "@mongodb-js/mcp-atlas-api-client";
import { Telemetry } from "../../src/telemetry/telemetry.js";

describe("Telemetry", () => {
    it("should resolve the actual device ID", async () => {
        const logger = new CompositeLogger();

        const deviceId = DeviceId.create(logger);
        const actualDeviceId = await deviceId.get();

        const telemetry = Telemetry.create({
            logger,
            deviceId,
            apiClient: new ApiClient({
                baseUrl: "https://fake.address.com/",
                credentials: {},
                userAgent: "",
                logger,
            }),
            keychain: new Keychain(),
            enabled: true,
        });

        expect(telemetry.getCommonProperties().device_id).toBe(undefined);

        await telemetry.setupPromise;

        expect(telemetry.getCommonProperties().device_id).toBe(actualDeviceId);
    });
});
