/**
 * Configuration for HTTP servers used by transport runners.
 */

/**
 * Configuration for the HTTP server (host, port, etc).
 */
export type HttpServerConfig = {
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
 * Features available on the monitoring server.
 */
export type MonitoringServerFeature = "health-check" | "metrics";

/**
 * Configuration for the monitoring server.
 */
export type MonitoringServerConfig = {
    /** Host to bind the monitoring server to */
    host: string;
    /** Port to bind the monitoring server to */
    port: number;
    /** Features to enable on the monitoring server */
    features: MonitoringServerFeature[];
};

/**
 * Configuration for session management.
 */
export type SessionManagementConfig = {
    /** Idle timeout in milliseconds */
    idleTimeoutMs: number;
    /** Notification timeout in milliseconds */
    notificationTimeoutMs: number;
    /** Whether to allow externally managed sessions */
    externallyManagedSessions: boolean;
};

/**
 * Configuration options for transport runners.
 */
export type TransportRunnerConfig = {
    /** Server name */
    name: string;
    /** Server version */
    version: string;
};
