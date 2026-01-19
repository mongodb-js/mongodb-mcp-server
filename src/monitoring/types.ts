/**
 * Monitoring events for internal observability and metrics collection.
 * These events are always emitted regardless of telemetry settings.
 * They are intended for local metrics collection (e.g., Prometheus) and should NOT be sent to external analytics services.
 *
 * These types are separate from telemetry types to allow independent evolution and configuration.
 */

/**
 * Constants for monitoring event names.
 * Use these constants instead of hardcoded strings to avoid typos and get type safety.
 */
export const MonitoringEventNames = {
    TOOL_EXECUTED: "tool-executed",
    SERVER_LIFECYCLE: "server-lifecycle",
    CONNECTION_LIFECYCLE: "connection-lifecycle",
} as const;

export type MonitoringEventName = (typeof MonitoringEventNames)[keyof typeof MonitoringEventNames];

/**
 * Base monitoring event structure
 */
export type MonitoringBaseEvent = {
    /** ISO 8601 timestamp when the event occurred */
    timestamp: string;
    /** Duration of the operation in milliseconds */
    duration_ms: number;
    /** Result of the operation */
    result: "success" | "failure";
};

/**
 * Tool execution monitoring event
 */
export type MonitoringToolEvent = MonitoringBaseEvent & {
    /** Event type identifier */
    type: "tool";
    /** Tool name that was executed */
    tool_name: string;
    /** Tool category (mongodb, atlas, atlas-local) */
    category: string;
    /** Additional metadata (optional) */
    metadata?: Record<string, unknown>;
};

/**
 * Server lifecycle monitoring event
 */
export type MonitoringServerEvent = MonitoringBaseEvent & {
    /** Event type identifier */
    type: "server";
    /** Server command (start, stop) */
    command: "start" | "stop";
    /** Additional metadata (optional) */
    metadata?: Record<string, unknown>;
};

/**
 * Connection lifecycle monitoring event
 * Note: Connection events are for monitoring only and are NOT sent to telemetry backend
 */
export type MonitoringConnectionEvent = MonitoringBaseEvent & {
    /** Event type identifier */
    type: "connection";
    /** Connection command (connect, disconnect) */
    command: "connect" | "disconnect";
    /** Connection type (e.g., "scram", "oidc-auth-flow", "x.509") */
    connection_type?: string;
    /** Atlas cluster name if applicable */
    cluster_name?: string;
    /** Whether this is an Atlas connection */
    is_atlas?: boolean;
    /** Additional metadata (optional) */
    metadata?: Record<string, unknown>;
};

/**
 * Union type of all monitoring events
 */
export type MonitoringEvent = MonitoringToolEvent | MonitoringServerEvent | MonitoringConnectionEvent;

/**
 * Monitoring event emitter interface
 */
export interface MonitoringEvents {
    /**
     * Emitted when a tool is executed
     */
    [MonitoringEventNames.TOOL_EXECUTED]: [event: MonitoringToolEvent];

    /**
     * Emitted when a server lifecycle event occurs (start, stop)
     */
    [MonitoringEventNames.SERVER_LIFECYCLE]: [event: MonitoringServerEvent];

    /**
     * Emitted when a connection event occurs (connect, disconnect)
     * Note: Connection events are NOT included in telemetry
     */
    [MonitoringEventNames.CONNECTION_LIFECYCLE]: [event: MonitoringConnectionEvent];
}

