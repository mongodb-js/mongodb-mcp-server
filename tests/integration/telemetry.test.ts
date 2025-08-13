import { createHmac } from "crypto";
import { Telemetry } from "../../src/telemetry/telemetry.js";
import { Session } from "../../src/common/session.js";
import { config, driverOptions } from "../../src/common/config.js";
import nodeMachineId from "node-machine-id";
import { describe, expect, it } from "vitest";
import { CompositeLogger } from "../../src/common/logger.js";
import { ConnectionManager } from "../../src/common/connectionManager.js";
import { ExportsManager } from "../../src/common/exportsManager.js";

describe("Telemetry", () => {
    it("should resolve the actual machine ID", async () => {
        const actualId: string = await nodeMachineId.machineId(true);

        const actualHashedId = createHmac("sha256", actualId.toUpperCase()).update("atlascli").digest("hex");

        const logger = new CompositeLogger();
        const telemetry = Telemetry.create(
            new Session({
                apiBaseUrl: "",
                logger,
                exportsManager: ExportsManager.init(config, logger),
                connectionManager: new ConnectionManager(config, driverOptions, logger),
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
