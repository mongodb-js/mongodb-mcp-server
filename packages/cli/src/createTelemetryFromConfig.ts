import type { CompositeLogger, Keychain } from "@mongodb-js/mcp-core";
import type { ApiClient } from "@mongodb-js/mcp-atlas-api-client";
import { AtlasTelemetry } from "@mongodb-js/mcp-atlas-telemetry";
import type { IDeviceId, ServerMetadata } from "@mongodb-js/mcp-types";
import type { UserConfig } from "./config/userConfig.js";

export type CreateTelemetryFromConfigOptions = {
    config: UserConfig;
    logger: CompositeLogger;
    deviceId: IDeviceId;
    apiClient: ApiClient;
    keychain: Keychain;
    serverMetadata: ServerMetadata;
};

export function createTelemetryFromConfig({
    config,
    logger,
    deviceId,
    apiClient,
    keychain,
    serverMetadata,
}: CreateTelemetryFromConfigOptions): AtlasTelemetry {
    return AtlasTelemetry.create({
        logger,
        deviceId,
        apiClient,
        keychain,
        enabled: config.telemetry === "enabled",
        serverMetadata,
    });
}
