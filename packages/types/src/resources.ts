import type { ResourceMetadata, ReadResourceCallback } from "@modelcontextprotocol/server";
import type { ITelemetry } from "./telemetry.js";
import type { IToolConfig } from "./config.js";
import type { ICompositeLogger } from "./logging.js";
import type { IKeychain } from "./keychain.js";
import type { TransportRequestContext } from "./transport.js";

/**
 * The minimal services resources read off the host server at construction,
 * injected individually (no server-scoped "session" object exists). The server
 * is deliberately stateless (connection state lives in the app-level registry),
 * so resources read only the specific services they need from the server;
 * host-specific extras (e.g. the connection registry) are read directly off
 * the concrete server type by the resource implementation.
 */
export type ResourceServices = {
    readonly config: IToolConfig;
    readonly logger: ICompositeLogger;
    readonly keychain: IKeychain;
};

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

/**
 * The host server surface resources register against and read services from.
 * Resources are constructed with the server itself (`{ server }`) and derive
 * the minimal services (config/logger/keychain) plus telemetry from it.
 */
export interface IResourceServer {
    readonly config: ResourceServices["config"];
    readonly logger: ResourceServices["logger"];
    readonly keychain: ResourceServices["keychain"];
    readonly telemetry: ITelemetry;
    mcpServer: {
        registerResource: (name: string, uri: string, config: ResourceMetadata, callback: ReadResourceCallback) => void;
    };
    sendResourceListChanged(): void;
    sendResourceUpdated(uri: string): void;
}

/**
 * The construction argument every resource class receives: the host server plus
 * the transport request that drove server creation (undefined for non-HTTP
 * constructions such as stdio / dry-run).
 */
export type ResourceServerArg<TServer extends IResourceServer = IResourceServer> = {
    server: TServer;
    /** The transport request that drove server creation (undefined for stdio / dry-run). */
    transportRequest?: TransportRequestContext;
};

/**
 * The type that all resource classes must conform to when implementing custom resources
 * for the MongoDB MCP Server.
 *
 * This type enforces that resource classes have a constructor accepting
 * `({ server })`, matching the construction pattern used by
 * {@link CliServer} (see `registerResources`). The resolved user
 * configuration is read from `server.config`.
 */
export type ResourceClass<TServer extends IResourceServer = IResourceServer> = {
    new (arg: ResourceServerArg<TServer>): { register(server: IResourceServer): void };
};

/** Resource constructor type for registries that may include resource-specific servers. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyResourceClass = ResourceClass<any>;
