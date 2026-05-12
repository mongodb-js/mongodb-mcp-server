import type { ILogger } from "./logging.js";
import type { IMetrics, MetricDefinitions, DefaultMetricDefinitions } from "./metrics.js";

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
 * Features available on the monitoring server.
 */
export type MonitoringServerFeature = "health-check" | "metrics";

/**
 * Options for configuring the monitoring server.
 */
export type MonitoringServerOptions = {
    /** HTTP server options */
    http: HttpServerOptions;
    /** Features to enable on the monitoring server */
    features: MonitoringServerFeature[];
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
 * Constructor arguments for creating a monitoring server.
 */
export type MonitoringServerConstructorArgs<TMetrics extends MetricDefinitions = DefaultMetricDefinitions> = {
    /** Options for configuring the monitoring server */
    options: MonitoringServerOptions;
    /** Logger for the server */
    logger: ILogger;
    /** Metrics instance */
    metrics: IMetrics<TMetrics>;
};

/**
 * Factory function type for creating a monitoring server.
 */
export type CreateMonitoringServerFn<TMetrics extends MetricDefinitions = DefaultMetricDefinitions> = (
    args: MonitoringServerConstructorArgs<TMetrics>
) => object | undefined;

/**
 * Options for transport runners.
 */
export type TransportRunnerOptions = {
    /** Server name */
    name: string;
    /** Server version */
    version: string;
};
