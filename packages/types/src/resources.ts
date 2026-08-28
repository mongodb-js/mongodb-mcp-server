import type { ResourceMetadata, ReadResourceCallback } from "@modelcontextprotocol/server";
import type { ITelemetry } from "./telemetry.js";
import type { IToolConfig } from "./config.js";
import type { ICompositeLogger } from "./logging.js";

/**
 * The minimal server-scoped surface resources may rely on. The server is
 * deliberately stateless (connection state lives in the app-level registry),
 * so resources are not constrained to the full {@link ISession} shape.
 */
export interface IResourceSession {
    readonly config: IToolConfig;
    readonly logger: ICompositeLogger;
}

export interface IResource {
    register(server: unknown): void;
}

export type IResources = readonly IResource[];

/** Static resource metadata (name/uri/description). Mirrors `resourceConfiguration` from v2-move. */
export type ResourceConfiguration = {
    name: string;
    uri: string;
    config: ResourceMetadata;
};

export type ReactiveResourceOptions<Value> = {
    initial: Value;
};

/** The host server surface resources register against. */
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
 * This type enforces that resource classes have a constructor accepting
 * `(session, telemetry)`, matching the construction pattern used by
 * {@link CliServer} (see `registerResources`). The resolved user
 * configuration is read from `session.config`.
 */
export type ResourceClass<TSession extends IResourceSession = IResourceSession> = {
    new (session: TSession, telemetry: ITelemetry): { register(server: IResourceServer): void };
};

/** Resource constructor type for registries that may include session-specific resource implementations. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyResourceClass = ResourceClass<any>;
