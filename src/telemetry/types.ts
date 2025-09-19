/**
 * Result type constants for telemetry events
 */
export type TelemetryResult = "success" | "failure";
export type ServerCommand = "start" | "stop";
export type TelemetryBoolSet = "true" | "false";

/**
 * Base interface for all events
 */
export type TelemetryEvent<T> = {
    timestamp: string;
    source: "mdbmcp";
    properties: T & {
        component: string;
        duration_ms: number;
        result: TelemetryResult;
        category: string;
    };
};

export type BaseEvent = TelemetryEvent<unknown>;

/**
 * Interface for tool events
 */
export type ToolEventProperties = {
    command: string;
    error_code?: string;
    error_type?: string;
    project_id?: string;
    org_id?: string;
    cluster_name?: string;
    is_atlas?: boolean;
};

export type ToolEvent = TelemetryEvent<ToolEventProperties>;
/**
 * Interface for server events
 */
export type ServerEventProperties = {
    command: ServerCommand;
    reason?: string;
    startup_time_ms?: number;
    runtime_duration_ms?: number;
    read_only_mode?: boolean;
    disabled_tools?: string[];
    confirmation_required_tools?: string[];
};

export type ServerEvent = TelemetryEvent<ServerEventProperties>;

/**
 * Interface for static properties, they can be fetched once and reused.
 */
export type CommonStaticProperties = {
    /**
     * The version of the MCP server (as read from package.json).
     */
    mcp_server_version: string;

    /**
     * The name of the MCP server (as read from package.json).
     */
    mcp_server_name: string;

    /**
     * The platform/OS the MCP server is running on.
     */
    platform: string;

    /**
     * The architecture of the OS the server is running on.
     */
    arch: string;

    /**
     * Same as platform.
     */
    os_type: string;

    /**
     * The version of the OS the server is running on.
     */
    os_version?: string;
};

/**
 * Common properties for all events that might change.
 */
export type CommonProperties = {
    /**
     * The device id - will be populated with the machine id when it resolves.
     */
    device_id?: string;

    /**
     * A boolean indicating whether the server is running in a container environment.
     */
    is_container_env?: boolean;

    /**
     * The version of the MCP client as reported by the client on session establishment.
     */
    mcp_client_version?: string;

    /**
     * The name of the MCP client as reported by the client on session establishment.
     */
    mcp_client_name?: string;

    /**
     * The transport protocol used by the MCP server.
     */
    transport?: "stdio" | "http";

    /**
     * A boolean indicating whether Atlas credentials are configured.
     */
    config_atlas_auth?: TelemetryBoolSet;

    /**
     * A boolean indicating whether a connection string is configured.
     */
    config_connection_string?: TelemetryBoolSet;

    /**
     * The randomly generated session id.
     */
    session_id?: string;

    /**
     * The way the MCP server is hosted - e.g. standalone for a server running independently or
     * "vscode" if embedded in the VSCode extension. This field should be populated by the hosting
     * application to differentiate events coming from an MCP server it's hosting.
     */
    hosting_mode?: string;
} & CommonStaticProperties;
