import { Telemetry } from "../../src/telemetry/telemetry.js";
import { Session } from "../../src/common/session.js";
import { config } from "../../src/common/config.js";
import { getDeviceIdForConnection } from "../../src/helpers/deviceId.js";
import { describe, expect, it } from "vitest";

describe("Telemetry", () => {
    it("should resolve the actual device ID", async () => {
        const actualDeviceId = await getDeviceIdForConnection();

        const telemetry = Telemetry.create(
            new Session({
                apiBaseUrl: "",
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
