import type { Session } from "../../src/common/session.js";
import type { UserConfig } from "../../src/common/config/userConfig.js";
import type { DeviceId } from "../../src/helpers/deviceId.js";
import type { CommonProperties } from "../../src/telemetry/types.js";
import { Telemetry } from "../../src/telemetry/telemetry.js";

export function createTelemetryForTest(
    session: Session,
    userConfig: UserConfig,
    deviceId: DeviceId,
    { commonProperties }: { commonProperties?: Partial<CommonProperties> } = {}
): Telemetry {
    return Telemetry.create({
        logger: session.logger,
        deviceId,
        apiClient: session.apiClient,
        keychain: session.keychain,
        telemetry: userConfig.telemetry,
        getCommonProperties: () => ({
            ...commonProperties,
            transport: userConfig.transport,
            mcp_client_version: session.mcpClient?.version,
            mcp_client_name: session.mcpClient?.name,
            session_id: session.sessionId,
            config_atlas_auth: session.apiClient?.isAuthConfigured() ? "true" : "false",
            config_connection_string: userConfig.connectionString ? "true" : "false",
        }),
    });
}
