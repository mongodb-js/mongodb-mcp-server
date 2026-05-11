import type { MongoLogId } from "@mongodb-js/mcp-types";

function mongoLogId(id: number): MongoLogId {
    return { __value: id };
}

/**
 * Transport-related log IDs for use by @mongodb-js/mcp-transports.
 * These are defined in @mongodb-js/mcp-core to avoid circular dependencies.
 */
export const LogId = {
    // Server lifecycle (1_000_0xx)
    serverStartFailure: mongoLogId(1_000_001),

    // HTTP Server lifecycle (1_006_1xx)
    httpServerStarted: mongoLogId(1_006_100),
    httpServerStopping: mongoLogId(1_006_101),
    httpServerStopped: mongoLogId(1_006_102),

    // Streamable HTTP Transport (1_006_0xx)
    streamableHttpTransportStarted: mongoLogId(1_006_001),
    streamableHttpTransportSessionCloseFailure: mongoLogId(1_006_002),
    streamableHttpTransportSessionCloseNotification: mongoLogId(1_006_003),
    streamableHttpTransportSessionCloseNotificationFailure: mongoLogId(1_006_004),
    streamableHttpTransportRequestFailure: mongoLogId(1_006_005),
    streamableHttpTransportCloseFailure: mongoLogId(1_006_006),
    streamableHttpTransportKeepAliveFailure: mongoLogId(1_006_007),
    streamableHttpTransportKeepAlive: mongoLogId(1_006_008),
    streamableHttpTransportHttpHostWarning: mongoLogId(1_006_009),
    streamableHttpTransportSessionNotFound: mongoLogId(1_006_010),
    streamableHttpTransportDisallowedExternalSessionError: mongoLogId(1_006_011),

    // Session Store (1_006_2xx)
    sessionStoreSessionNotFound: mongoLogId(1_006_200),
    sessionStoreNotificationFailure: mongoLogId(1_006_201),
    sessionStoreSessionClosed: mongoLogId(1_006_202),

    // Monitoring Server (1_013_xxx)
    monitoringServerMetricsFailure: mongoLogId(1_013_001),
} as const;
