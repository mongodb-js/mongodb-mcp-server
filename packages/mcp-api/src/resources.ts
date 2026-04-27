import type { ResourceMetadata } from "@modelcontextprotocol/sdk/server/mcp.js";

/**
 * Static configuration describing an MCP resource exposed by the server.
 */
export type ResourceConfiguration = {
    name: string;
    uri: string;
    config: ResourceMetadata;
};

/**
 * Options consumed by the `ReactiveResource` base class.
 *
 * `RelevantEvents` is the tuple of session event names the resource subscribes
 * to and reduces over.
 */
export type ReactiveResourceOptions<Value, RelevantEvents extends readonly string[]> = {
    initial: Value;
    events: RelevantEvents;
};

/**
 * Public surface of every resource type. Concrete `ReactiveResource`
 * implementations live in other packages and additionally expose a
 * `register(server)` method.
 */
export interface IResource {
    /**
     * Registers the resource with the supplied server instance so that the
     * MCP client can subscribe to it.
     */
    register(server: unknown): void;

    /**
     * Returns the current value of the resource serialized as a string. May
     * be synchronous or asynchronous depending on the implementation.
     */
    toOutput(): string | Promise<string>;
}

/**
 * Constructor for a built-in MCP resource. Resources are instantiated by the
 * server with the session, user-config and telemetry instance available to
 * them.
 */
export type ResourceClass<TSession = unknown, TConfig = unknown, TTelemetry = unknown> = new (
    session: TSession,
    config: TConfig,
    telemetry: TTelemetry
) => IResource;

/**
 * The collection of resources advertised by the MCP server.
 */
export type IResources = ReadonlyArray<ResourceClass>;
