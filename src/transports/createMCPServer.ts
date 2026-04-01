import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { MCPServer, RequestContext } from "@mongodb-mcp/transport";
import type { Metrics, DefaultMetrics } from "@mongodb-mcp/monitoring";
import type { UserConfig } from "../common/config/userConfig.js";
import type { LoggerBase } from "../common/logging/index.js";
import { CompositeLogger } from "../common/logging/index.js";
import { Session } from "../common/session.js";
import { Server } from "../server.js";
import { Telemetry } from "../telemetry/telemetry.js";
import { Elicitation } from "../elicitation.js";
import { defaultCreateConnectionManager } from "../common/connectionManager.js";
import { connectionErrorHandler } from "../common/connectionErrorHandler.js";
import { defaultCreateApiClient } from "../common/atlas/apiClient.js";
import { defaultCreateAtlasLocalClient } from "../common/atlasLocal.js";
import { DeviceId } from "../helpers/deviceId.js";
import { Keychain } from "../common/keychain.js";
import { ExportsManager } from "../common/exportsManager.js";
import { packageInfo } from "../common/packageInfo.js";
import { applyConfigOverrides } from "../common/config/configOverrides.js";

export async function createMCPServer({
    config,
    logger,
    metrics,
    request,
}: {
    config: UserConfig;
    logger: LoggerBase;
    metrics: Metrics<DefaultMetrics>;
    request?: RequestContext;
}): Promise<MCPServer> {
    const finalConfig = applyConfigOverrides({ baseConfig: config, request });

    const compositeLogger = logger instanceof CompositeLogger ? logger : new CompositeLogger(logger);

    const deviceId = DeviceId.create(compositeLogger);
    const connectionManager = await defaultCreateConnectionManager({
        userConfig: finalConfig,
        logger: compositeLogger,
        deviceId,
    });
    const keychain = new Keychain();
    const exportsManager = ExportsManager.init(finalConfig, compositeLogger);

    const apiClient = defaultCreateApiClient(
        {
            baseUrl: finalConfig.apiBaseUrl,
            credentials: {
                clientId: finalConfig.apiClientId,
                clientSecret: finalConfig.apiClientSecret,
            },
        },
        compositeLogger
    );

    const atlasLocalClient = await defaultCreateAtlasLocalClient({ logger: compositeLogger });

    const session = new Session({
        userConfig: finalConfig,
        logger: compositeLogger,
        exportsManager,
        connectionManager,
        keychain,
        connectionErrorHandler,
        apiClient,
        atlasLocalClient,
    });

    const telemetry = Telemetry.create(session, finalConfig, deviceId);

    const mcpServerInstance = new McpServer({
        name: packageInfo.mcpServerName,
        version: packageInfo.version,
    });

    const elicitation = new Elicitation({ server: mcpServerInstance.server });

    let uiRegistry;
    if (finalConfig.previewFeatures.includes("mcpUI")) {
        const { UIRegistry } = await import("../ui/registry/registry.js");
        uiRegistry = new UIRegistry();
    }

    return new Server({
        session,
        userConfig: finalConfig,
        telemetry,
        mcpServer: mcpServerInstance,
        elicitation,
        connectionErrorHandler,
        uiRegistry,
        metrics,
    });
}
