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
    } & Record<string, string | number | string[]>;
};

export type BaseEvent = TelemetryEvent<unknown>;

/**
 * Interface for tool events
 */
export type ToolEventProperties = {
    command: string;
    error_code?: string;
    error_type?: string;
    cluster_name?: string;
    is_atlas?: boolean;
} & TelemetryToolMetadata;

export type ToolEvent = TelemetryEvent<ToolEventProperties>;

/**
 * Interface for server events
 */
export type ServerEventProperties = {
    command: ServerCommand;
    reason?: string;
    startup_time_ms?: number;
    runtime_duration_ms?: number;
    read_only_mode?: TelemetryBoolSet;
    disabled_tools?: string[];
    confirmation_required_tools?: string[];
    previewFeatures?: string[];
};

export type ServerEvent = TelemetryEvent<ServerEventProperties>;

/**
 * Commands emitted by the interactive setup CLI. Each command corresponds to
 * a single logical step of the wizard, so downstream analytics can reason
 * about drop-off between steps as well as overall completion rates.
 */
export type SetupCommand =
    | "started"
    | "prerequisites_checked"
    | "ai_tool_selected"
    | "read_only_selected"
    | "connection_string_entered"
    | "service_account_id_entered"
    | "service_account_secret_entered"
    | "credentials_validated"
    | "editor_configured"
    | "open_config_prompted"
    | "completed"
    | "cancelled"
    | "failed";

/**
 * Properties shared across all setup events. Every event carries the full
 * accumulated context known up to that point so each event is independently
 * queryable.
 */
export type SetupEventProperties = {
    command: SetupCommand;

    /**
     * Random id generated at the start of a setup run. All events emitted by
     * the same wizard invocation share this id so they can be correlated.
     */
    setup_session_id: string;

    /** The AI tool selected by the user, once known. */
    ai_tool?: string;

    /** Whether the user opted to install the MCP server in read-only mode. */
    is_read_only?: TelemetryBoolSet;

    /** Whether a reachable Docker daemon was detected on the machine. */
    has_docker?: TelemetryBoolSet;

    /** Whether the current OS/architecture is supported by the MCP server. */
    platform_supported?: TelemetryBoolSet;

    /** Whether the Node.js version satisfies the package's engines range. */
    node_version_ok?: TelemetryBoolSet;

    /** Whether the user supplied a MongoDB connection string. */
    connection_string_provided?: TelemetryBoolSet;

    /** Whether the user opted to test the provided connection string. */
    connection_string_tested?: TelemetryBoolSet;

    /** Number of connection string attempts (initial + retries) the user made. */
    connection_test_attempts?: number;

    /** Whether the user supplied an Atlas Service Account client id. */
    service_account_id_provided?: TelemetryBoolSet;

    /** Whether the user supplied an Atlas Service Account client secret. */
    service_account_secret_provided?: TelemetryBoolSet;

    /** Whether the user accepted the auto-detected config path. */
    used_default_config_path?: TelemetryBoolSet;

    /** Whether the user opted to open the config file at the end of setup. */
    opened_config_file?: TelemetryBoolSet;

    /** On terminal events, the last completed step before terminating. */
    last_step?: SetupCommand;

    /** Populated on failure events (and where a step failed with an error). */
    error_type?: string;

    /** Total wall-clock duration of the setup run, set on terminal events. */
    total_duration_ms?: number;
};

export type SetupEvent = TelemetryEvent<SetupEventProperties>;

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
    is_container_env?: TelemetryBoolSet;

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

/**
 * Telemetry metadata that can be provided by tools when emitting telemetry events.
 * For MongoDB tools, this is typically empty, while for Atlas tools, this should include
 * the project and organization IDs if available.
 */
export type TelemetryToolMetadata = AtlasMetadata | ConnectionMetadata | PerfAdvisorToolMetadata | StreamsToolMetadata;

export type AtlasMetadata = {
    project_id?: string;
    org_id?: string;
};

export type AtlasLocalToolMetadata = {
    atlas_local_deployment_id?: string;
};

export type ConnectionMetadata = AtlasMetadata &
    AtlasLocalToolMetadata & {
        connection_auth_type?: string;
        connection_host_type?: string;
    };

export type PerfAdvisorToolMetadata = AtlasMetadata &
    ConnectionMetadata & {
        operations: string[];
    };

export type StreamsToolMetadata = AtlasMetadata & {
    action?: string;
    resource?: string;
};
