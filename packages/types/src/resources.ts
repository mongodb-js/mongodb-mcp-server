import type { ResourceMetadata, ReadResourceCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SessionEvents, ISession } from "./session.js";
import type { ITelemetry } from "./telemetry.js";
import type { IElicitation } from "./elicitation.js";
import type { DefaultMetricDefinitions, IMetrics } from "./metrics.js";

export interface IResource {
    register(server: unknown): void;
}

export type IResources = readonly IResource[];

export type ResourceDefinition = {
    name: string;
    uri: string;
    config: ResourceMetadata;
};

export type ReactiveResourceOptions<Value, RelevantEvents extends readonly (keyof SessionEvents)[]> = {
    resource: ResourceDefinition;
    initial: Value;
    events: RelevantEvents;
};

/**
 * Parameters passed to the constructor of all resources that extends `ReactiveResource`.
 *
 * The MongoDB MCP Server automatically injects these parameters when
 * constructing resources and registering to the MCP Server.
 */
export type ResourceConstructorParams<
    TSession extends ISession = ISession,
    TMetricsDefinitions extends DefaultMetricDefinitions = DefaultMetricDefinitions,
> = {
    /**
     * An instance of Session class providing access to MongoDB connections,
     * loggers, config, etc.
     */
    session: TSession;

    /**
     * The telemetry service for tracking resource usage.
     */
    telemetry: ITelemetry;

    /**
     * The elicitation service for requesting user confirmation.
     */
    elicitation: IElicitation;

    /**
     * The metrics service for tracking resource usage.
     */
    metrics: IMetrics<TMetricsDefinitions>;
};

export interface IResourceServer {
    mcpServer: {
        registerResource: (name: string, uri: string, config: ResourceMetadata, callback: ReadResourceCallback) => void;
    };
    sendResourceListChanged(): void;
    sendResourceUpdated(uri: string): void;
}

/**
 * The type that all resource classes must conform to when implementing custom resources
 * for the MongoDB MCP Server.
 *
 * This type enforces that resource classes have a constructor that accepts `ResourceConstructorParams`.
 */
export type ResourceClass<
    TSession extends ISession = ISession,
    TMetrics extends DefaultMetricDefinitions = DefaultMetricDefinitions,
> = {
    /** Constructor signature for the resource class */
    new (params: ResourceConstructorParams<TSession, TMetrics>): { register(server: IResourceServer): void };
};

/** Resource constructor type for registries that may include session-specific resource implementations. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyResourceClass = ResourceClass<any, any>;
