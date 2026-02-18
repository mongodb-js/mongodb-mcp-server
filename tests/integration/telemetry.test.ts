import { Telemetry } from "../../src/telemetry/telemetry.js";
import { Session } from "../../src/common/session.js";
import { DeviceId } from "../../src/helpers/deviceId.js";
import { describe, expect, it } from "vitest";
import { CompositeLogger } from "../../src/common/logger.js";
import { MCPConnectionManager } from "../../src/common/connectionManager.js";
import { connectionErrorHandler } from "../../src/common/connectionErrorHandler.js";
import { ExportsManager } from "../../src/common/exportsManager.js";
import { Keychain } from "../../src/common/keychain.js";
import { VectorSearchEmbeddingsManager } from "../../src/common/search/vectorSearchEmbeddingsManager.js";
import { defaultTestConfig } from "./helpers.js";
import { type UserConfig } from "../../src/common/config/userConfig.js";
import { defaultCreateApiClient } from "../../src/common/atlas/apiClient.js";

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
                vectorSearchEmbeddingsManager: new VectorSearchEmbeddingsManager(config, connectionManager),
                apiClient: defaultCreateApiClient(
                    {
                        baseUrl: config.apiBaseUrl,
                        credentials: {
                            clientId: config.apiClientId,
                            clientSecret: config.apiClientSecret,
                        },
                    },
                    logger
                ),
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
