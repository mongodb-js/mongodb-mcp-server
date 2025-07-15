import { createHmac } from "crypto";
import { Telemetry } from "../../src/telemetry/telemetry.js";
import { Session } from "../../src/common/session.js";
import { config } from "../../src/common/config.js";
import nodeMachineId from "node-machine-id";
import { describe, expect, it } from "vitest";

describe("Telemetry", () => {
    it("should resolve the actual machine ID", async () => {
        const actualId: string = await nodeMachineId.machineId(true);

        const actualHashedId = createHmac("sha256", actualId.toUpperCase()).update("atlascli").digest("hex");

        const telemetry = Telemetry.create(
            new Session({
                apiBaseUrl: "",
            }),
            config
        );

        expect(telemetry.getCommonProperties().device_id).toBe(undefined);
        expect(telemetry["isBufferingEvents"]).toBe(true);

        await telemetry.setupPromise;

        expect(telemetry.getCommonProperties().device_id).toBe(actualHashedId);
        expect(telemetry["isBufferingEvents"]).toBe(false);
    });
});
