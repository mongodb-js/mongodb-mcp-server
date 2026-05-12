import type { MongoLogId } from "@mongodb-js/mcp-types";

function mongoLogId(id: number): MongoLogId {
    return { __value: id };
}

/**
 * Log IDs for use across all MCP packages.
 * These are defined in @mongodb-js/mcp-core to avoid circular dependencies.
 */
export const LogId = {
    // Server lifecycle (1_000_0xx)
    serverStartFailure: mongoLogId(1_000_001),
    serverInitialized: mongoLogId(1_000_002),
    serverCloseRequested: mongoLogId(1_000_003),
    serverClosed: mongoLogId(1_000_004),
    serverCloseFailure: mongoLogId(1_000_005),
    serverDuplicateLoggers: mongoLogId(1_000_006),
    serverMcpClientSet: mongoLogId(1_000_007),

    // Atlas (1_001_xxx)
    atlasCheckCredentials: mongoLogId(1_001_001),
    atlasDeleteDatabaseUserFailure: mongoLogId(1_001_002),
    atlasConnectFailure: mongoLogId(1_001_003),
    atlasInspectFailure: mongoLogId(1_001_004),
    atlasConnectAttempt: mongoLogId(1_001_005),
    atlasConnectSucceeded: mongoLogId(1_001_006),
    atlasApiRevokeFailure: mongoLogId(1_001_007),
    atlasIpAccessListAdded: mongoLogId(1_001_008),
    atlasIpAccessListAddFailure: mongoLogId(1_001_009),
    atlasApiBaseUrlInsecure: mongoLogId(1_001_010),

    // Telemetry (1_002_xxx)
    telemetryDisabled: mongoLogId(1_002_001),
    telemetryEmitFailure: mongoLogId(1_002_002),
    telemetryEmitStart: mongoLogId(1_002_003),
    telemetryEmitSuccess: mongoLogId(1_002_004),
    telemetryMetadataError: mongoLogId(1_002_005),
    deviceIdResolutionError: mongoLogId(1_002_006),
    deviceIdTimeout: mongoLogId(1_002_007),
    telemetryClose: mongoLogId(1_002_008),
    telemetryRateLimited: mongoLogId(1_002_009),

    // Tools (1_003_xxx)
    toolExecute: mongoLogId(1_003_001),
    toolExecuteFailure: mongoLogId(1_003_002),
    toolDisabled: mongoLogId(1_003_003),
    toolMetadataChange: mongoLogId(1_003_004),

    // MongoDB (1_004_xxx)
    mongodbConnectFailure: mongoLogId(1_004_001),
    mongodbDisconnectFailure: mongoLogId(1_004_002),
    mongodbConnectTry: mongoLogId(1_004_003),
    mongodbCursorCloseError: mongoLogId(1_004_004),
    mongodbIndexCheckFailure: mongoLogId(1_004_005),
    searchCapabilityProbe: mongoLogId(1_004_006),

    // Resources/Tools metadata (1_005_xxx)
    toolUpdateFailure: mongoLogId(1_005_001),
    resourceUpdateFailure: mongoLogId(1_005_002),
    updateToolMetadata: mongoLogId(1_005_003),
    toolValidationError: mongoLogId(1_005_004),

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

    // HTTP Server lifecycle (1_006_1xx)
    httpServerStarted: mongoLogId(1_006_100),
    httpServerStopping: mongoLogId(1_006_101),
    httpServerStopped: mongoLogId(1_006_102),

    // Session Store (1_006_2xx)
    sessionStoreSessionNotFound: mongoLogId(1_006_200),
    sessionStoreNotificationFailure: mongoLogId(1_006_201),
    sessionStoreSessionClosed: mongoLogId(1_006_202),

    // Exports (1_007_xxx)
    exportCleanupError: mongoLogId(1_007_001),
    exportCreationError: mongoLogId(1_007_002),
    exportCreationCleanupError: mongoLogId(1_007_003),
    exportReadError: mongoLogId(1_007_004),
    exportCloseError: mongoLogId(1_007_005),
    exportedDataListError: mongoLogId(1_007_006),
    exportedDataAutoCompleteError: mongoLogId(1_007_007),
    exportLockError: mongoLogId(1_007_008),

    // OIDC (1_008_xxx)
    oidcFlow: mongoLogId(1_008_001),

    // Atlas Performance Advisor (1_009_xxx)
    atlasPaSuggestedIndexesFailure: mongoLogId(1_009_001),
    atlasPaDropIndexSuggestionsFailure: mongoLogId(1_009_002),
    atlasPaSchemaAdviceFailure: mongoLogId(1_009_003),
    atlasPaSlowQueryLogsFailure: mongoLogId(1_009_004),

    // Atlas Local (1_010_xxx)
    atlasLocalDockerNotRunning: mongoLogId(1_010_001),
    atlasLocalUnsupportedPlatform: mongoLogId(1_010_002),

    // Assistant (1_011_xxx)
    assistantListKnowledgeSourcesError: mongoLogId(1_011_001),
    assistantSearchKnowledgeError: mongoLogId(1_011_002),

    // Streams (1_012_xxx)
    streamsProcessorStateLookupFailure: mongoLogId(1_012_001),

    // Monitoring Server (1_013_xxx)
    monitoringServerMetricsFailure: mongoLogId(1_013_001),
} as const;
