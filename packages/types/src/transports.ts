/**
 * Options for configuring the HTTP server (host, port, etc).
 */
export type HttpServerOptions = {
    /** Host to bind the HTTP server to */
    host: string;
    /** Port to bind the HTTP server to */
    port: number;
    /** Maximum HTTP body size in bytes */
    bodyLimit?: number;
    /** Headers to validate */
    headers?: Record<string, string>;
    /** Response type: 'sse' for Server-Sent Events, 'json' for JSON responses */
    responseType?: "sse" | "json";
};

/**
 * Options for session management.
 */
export type SessionManagementOptions = {
    /** Idle timeout in milliseconds */
    idleTimeoutMs: number;
    /** Notification timeout in milliseconds */
    notificationTimeoutMs: number;
    /** Whether to allow externally managed sessions */
    externallyManagedSessions: boolean;
};

/**
 * Options for transport runners.
 */
export type TransportRunnerOptions = {
    /** Server name */
    name: string;
    /** Server version */
    version: string;
};
