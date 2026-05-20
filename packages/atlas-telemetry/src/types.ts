import type {
    TelemetryBoolSet,
    TelemetryCommonProperties,
    TelemetryCommonStaticProperties,
    TelemetryEvent,
    TelemetryResult,
} from "@mongodb-js/mcp-types";

export type {
    TelemetryBoolSet,
    TelemetryCommonProperties,
    TelemetryCommonStaticProperties,
    TelemetryEvent,
    TelemetryResult,
};

export type TelemetryServerCommand = "start" | "stop";

export type TelemetryBaseEvent = TelemetryEvent<unknown>;

/**
 * Interface for tool events
 */
export type TelemetryToolEventProperties = {
    command: string;
    error_code?: string;
    error_type?: string;
    cluster_name?: string;
    is_atlas?: boolean;
} & TelemetryToolMetadata;

export type TelemetryToolEvent = TelemetryEvent<TelemetryToolEventProperties>;

/**
 * Interface for server events
 */
export type TelemetryServerEventProperties = {
    command: TelemetryServerCommand;
    reason?: string;
    startup_time_ms?: number;
    runtime_duration_ms?: number;
    read_only_mode?: TelemetryBoolSet;
    disabled_tools?: string[];
    confirmation_required_tools?: string[];
    previewFeatures?: string[];
};

export type TelemetryServerEvent = TelemetryEvent<TelemetryServerEventProperties>;

/**
 * Commands emitted by the interactive setup CLI. Each command corresponds to
 * a single logical step of the wizard, so downstream analytics can reason
 * about drop-off between steps as well as overall completion rates.
 */
export type TelemetrySetupStage =
    | "started"
    | "prerequisites_checked"
    | "ai_tool_selected"
    | "read_only_selected"
    | "connection_string_entered"
    | "service_account_id_entered"
    | "service_account_secret_entered"
    | "credentials_validated"
    | "editor_configured"
    | "skills_install_prompted"
    | "open_config_prompted"
    | "completed"
    | "cancelled"
    | "failed";

/**
 * Properties shared across all setup events. Every event carries the full
 * accumulated context known up to that point so each event is independently
 * queryable.
 */
export type TelemetrySetupEventProperties = {
    stage: TelemetrySetupStage;

    /**
     * Random id generated at the start of a setup run. All events emitted by
     * the same wizard invocation share this id so they can be correlated.
     */
    setup_session_id: string;

    /** The AI tool selected by the user, once known. */
    ai_tool?: string;

    /** Whether the user opted to install the MCP server in read-only mode. */
    read_only_mode?: TelemetryBoolSet;

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

    /** Outcome of the agent-skills install step. */
    skills_install_status?: "installed" | "skipped" | "failed";

    /** If the skills step was skipped, why. */
    skills_skip_reason?: "no-agent-id" | "user-declined";

    /** If skills install failed, the subprocess exit code (-1 sentinel for spawn errors). */
    skills_install_exit_code?: number;

    /** On terminal events, the last completed step before terminating. */
    last_stage?: TelemetrySetupStage;

    /** Populated on failure events (and where a step failed with an error). */
    error_type?: string;

    /** Total wall-clock duration of the setup run, set on terminal events. */
    total_duration_ms?: number;
} & Pick<TelemetryCommonProperties, "has_docker">;

export type TelemetrySetupEvent = TelemetryEvent<TelemetrySetupEventProperties>;

/**
 * Telemetry metadata that can be provided by tools when emitting telemetry events.
 * For MongoDB tools, this is typically empty, while for Atlas tools, this should include
 * the project and organization IDs if available.
 */
export type TelemetryToolMetadata =
    | AtlasMetadata
    | AtlasConnectionMetadata
    | AtlasPerfAdvisorToolMetadata
    | AtlasStreamsToolMetadata
    | UpgradeClusterMetadata;

export type AtlasMetadata = {
    project_id?: string;
    org_id?: string;
};

export type AtlasLocalToolMetadata = {
    atlas_local_deployment_id?: string;
};

export type AtlasConnectionMetadata = AtlasMetadata &
    AtlasLocalToolMetadata & {
        connection_auth_type?: string;
        connection_host_type?: string;
    };

export type AtlasPerfAdvisorToolMetadata = AtlasMetadata &
    AtlasConnectionMetadata & {
        operations: string[];
    };

export type AtlasStreamsToolMetadata = AtlasMetadata & {
    action?: string;
    resource?: string;
};

export type UpgradeClusterMetadata = AtlasMetadata & {
    original_tier?: "free" | "flex";
    target_tier?: "flex" | "m10";
    original_cluster_id?: string;
    target_cluster_id?: string;
    provider?: string;
    region?: string;
};
