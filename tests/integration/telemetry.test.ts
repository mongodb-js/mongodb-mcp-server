import { createHmac } from "crypto";
import { Telemetry } from "../../src/telemetry/telemetry.js";
import { Session } from "../../src/session.js";
import { config } from "../../src/config.js";
import nodeMachineId from "node-machine-id";

describe("Telemetry", () => {
    it("should resolve the actual machine ID", async () => {
        const actualId: string = await nodeMachineId.machineId(true);

        const actualHashedId = createHmac("sha256", actualId.toUpperCase()).update("atlascli").digest("hex");

        const telemetry = Telemetry.create({
            session: new Session({
                apiBaseUrl: "",
            }),
            userConfig: config,
        });

        const commonProperties = await telemetry.getCommonProperties();

        expect(commonProperties.device_id).toBe(undefined);
        expect(telemetry["isBufferingEvents"]).toBe(true);

        await telemetry.deviceIdPromise;

        expect(commonProperties.device_id).toBe(actualHashedId);
        expect(telemetry["isBufferingEvents"]).toBe(false);
    });
});
