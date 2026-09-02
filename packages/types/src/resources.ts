import type { ResourceMetadata, ReadResourceCallback } from "@modelcontextprotocol/server";
import type { ITelemetry } from "./telemetry.js";
import type { IToolConfig } from "./config.js";
import type { ICompositeLogger } from "./logging.js";
import type { IKeychain } from "./keychain.js";

/**
 * The minimal services resources receive at construction, injected
 * individually (no server-scoped \"session\" object exists). The server is
 * deliberately stateless (connection state lives in the app-level registry),
 * so resources receive only the specific services they need; host-specific
 * extras (e.g. the connection registry) are added by the resource type.
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
 * `(services, telemetry)`, matching the construction pattern used by
 * {@link CliServer} (see `registerResources`). The resolved user
 * configuration is read from `services.config`.
 */
export type ResourceClass<TServices extends ResourceServices = ResourceServices> = {
    new (services: TServices, telemetry: ITelemetry): { register(server: IResourceServer): void };
};

/** Resource constructor type for registries that may include resource-specific services. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyResourceClass = ResourceClass<any>;
