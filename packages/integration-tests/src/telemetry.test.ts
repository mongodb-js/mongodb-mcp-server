import { DeviceId } from "@mongodb-js/mcp-tools-mongodb";
import { describe, expect, it } from "vitest";
import { CompositeLogger } from "@mongodb-js/mcp-core";
import { Keychain } from "@mongodb-js/mcp-core";
import { createTestApiClient } from "./integrationHelpers.js";
import { AtlasTelemetry } from "@mongodb-js/mcp-atlas-telemetry";

describe("AtlasTelemetry", () => {
    it("should resolve the actual device ID", async () => {
        const logger = new CompositeLogger();

        const deviceId = DeviceId.create(logger);
        const actualDeviceId = await deviceId.get();

        const telemetry = AtlasTelemetry.create({
            logger,
            deviceId,
            apiClient: createTestApiClient({
                baseUrl: "https://fake.address.com/",
                serverMetadata: {
                    mcpServerName: "test-server",
                    version: "1.0.0",
                },
                logger,
            }),
            keychain: new Keychain(),
            enabled: true,
            serverMetadata: {
                mcpServerName: "test-server",
                version: "1.0.0",
            },
        });

        expect(telemetry.getCommonProperties().device_id).toBe(undefined);

        await telemetry.setupPromise;

        expect(telemetry.getCommonProperties().device_id).toBe(actualDeviceId);
    });
});
