import { Telemetry } from "../../src/telemetry/telemetry.js";
import { Session } from "../../src/common/session.js";
import { DeviceId } from "../../src/helpers/deviceId.js";
import { describe, expect, it } from "vitest";
import { CompositeLogger } from "@mongodb-js/mcp-core";
import { MCPConnectionManager } from "../../src/common/connectionManager.js";
import { connectionErrorHandler } from "../../src/common/connectionErrorHandler.js";
import { ExportsManager } from "../../src/common/exportsManager.js";
import { Keychain } from "@mongodb-js/mcp-core";
import { defaultTestConfig } from "./helpers.js";
import { type UserConfig } from "../../src/common/config/userConfig.js";
import { ApiClient } from "@mongodb-js/mcp-atlas-api-client";

describe("Telemetry", () => {
    const config: UserConfig = { ...defaultTestConfig, telemetry: "enabled" };
    it("should resolve the actual device ID", async () => {
        const logger = new CompositeLogger();

        const deviceId = DeviceId.create(logger);
        const actualDeviceId = await deviceId.get();
        const connectionManager = new MCPConnectionManager(config, logger, deviceId);

        const telemetry = Telemetry.create(
            new Session({
                userConfig: defaultTestConfig,
                logger,
                exportsManager: ExportsManager.init(config, logger),
                connectionManager: connectionManager,
                keychain: new Keychain(),
                connectionErrorHandler,
                apiClient: new ApiClient({
                    baseUrl: config.apiBaseUrl,
                    credentials: {
                        clientId: config.apiClientId,
                        clientSecret: config.apiClientSecret,
                    },
                    userAgent: "",
                    logger,
                }),
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
});
