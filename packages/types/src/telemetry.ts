export type TelemetryEvents = {
    "events-emitted": [];
    "events-send-failed": [];
    "events-skipped": [];
};

export interface ITelemetry {
    isTelemetryEnabled(): boolean;
    emitEvents(events: unknown[]): void;
    close(): Promise<void>;
}

export type TelemetryResult = "success" | "failure";

export type TelemetryBoolSet = "true" | "false";

export type TelemetryCommonStaticProperties = {
    mcp_server_version: string;
    mcp_server_name: string;
    platform: string;
    arch: string;
    os_type: string;
    os_version?: string;
};

export type TelemetryCommonProperties = {
    device_id?: string;
    is_container_env?: TelemetryBoolSet;
    mcp_client_version?: string;
    mcp_client_name?: string;
    transport?: "stdio" | "http";
    config_atlas_auth?: TelemetryBoolSet;
    config_connection_string?: TelemetryBoolSet;
    session_id?: string;
    hosting_mode?: string;
    has_docker?: TelemetryBoolSet;
} & TelemetryCommonStaticProperties;

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

export type TelemetryToolMetadataValue = string | number | boolean | undefined | string[];

export type TelemetryToolMetadataBase = {
    [key: string]: TelemetryToolMetadataValue;
};

export type AtlasMetadata = TelemetryToolMetadataBase & {
    project_id?: string;
    org_id?: string;
};

export type AtlasLocalToolMetadata = TelemetryToolMetadataBase & {
    atlas_local_deployment_id?: string;
};

export type SharedTierTier = "Free" | "Flex";

export const SHARED_TIER_METRIC_NAMES = [
    "CONNECTIONS_PERCENT",
    "FLEX_CONNECTIONS_PERCENT",
    "FLEX_DATA_SIZE_TOTAL",
    "LOGICAL_SIZE",
] as const;

export type SharedTierMetricName = (typeof SHARED_TIER_METRIC_NAMES)[number];

export type ConnectionMetadata = AtlasMetadata &
    AtlasLocalToolMetadata & {
        connection_auth_type?: string;
        connection_host_type?: string;
        shared_tier_alerts_detected?: TelemetryBoolSet;
        shared_tier_tier?: SharedTierTier;
        shared_tier_alerts?: SharedTierMetricName[];
    };

export type PerfAdvisorToolMetadata = AtlasMetadata &
    ConnectionMetadata & {
        operations: string[];
    };

export type StreamsToolMetadata = AtlasMetadata & {
    action?: string;
    resource?: string;
};

export type TelemetryToolMetadata = AtlasMetadata | ConnectionMetadata | PerfAdvisorToolMetadata | StreamsToolMetadata;

export type ToolEventProperties = {
    command: string;
    error_code?: string;
    error_type?: string;
    is_atlas?: boolean;
} & TelemetryToolMetadata;

export type ToolEvent = TelemetryEvent<ToolEventProperties>;
