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

export type ToolEventProperties = {
    command: string;
    error_code?: string;
    error_type?: string;
    cluster_name?: string;
    is_atlas?: boolean;
} & TelemetryToolMetadata;

export type ToolEvent = TelemetryEvent<ToolEventProperties>;

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

export type TelemetryToolMetadata = AtlasMetadata | ConnectionMetadata | PerfAdvisorToolMetadata | StreamsToolMetadata;
