// Log IDs for the transport package
export const LogId = {
    // HTTP Server
    httpServerStarted: "http-server-started",
    httpServerStopping: "http-server-stopping",
    httpServerStopped: "http-server-stopped",
    httpServerNotRunning: "http-server-not-running",

    // Session
    sessionCreated: "session-created",
    sessionClosed: "session-closed",
    sessionNotFound: "session-not-found",
    sessionCloseError: "session-close-error",

    // Transport
    transportStarted: "transport-started",
    transportClosed: "transport-closed",
    transportCloseError: "transport-close-error",

    // Request handling
    requestError: "request-error",
    metricsError: "metrics-error",

    // Server
    serverStartFailure: "server-start-failure",

    // Validation
    validationError: "validation-error",
} as const;

export type LogId = (typeof LogId)[keyof typeof LogId];
