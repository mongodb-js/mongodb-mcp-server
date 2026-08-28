import type { ApiClient } from "@mongodb-js/mcp-atlas-api-client";
import type { CompositeLogger, Keychain } from "@mongodb-js/mcp-core";
import type { ConnectionErrorHandler, ConnectionRegistry, ExportsManager } from "@mongodb-js/mcp-tools-mongodb";
import type { Client } from "@mongodb-js/atlas-local";
import type { UserConfig } from "./config/userConfig.js";

export type ServerServicesOptions = {
    /** Effective configuration for this server (base config plus any request-scoped overrides). */
    config: UserConfig;
    logger: CompositeLogger;
    keychain: Keychain;
    connectionRegistry: ConnectionRegistry;
    exportsManager: ExportsManager;
    atlasLocalClient?: Client;
    connectionErrorHandler: ConnectionErrorHandler;
    apiClient: ApiClient;
};

/**
 * The server-scoped context handed to tools and resources registered by the
 * CLI.
 *
 * This is deliberately **stateless**: it holds references to app-level
 * services that are constructed once per process (logger, keychain, app-level
 * connection registry, exports manager, Atlas API client) plus the effective
 * configuration for this server instance. MongoDB connection state lives in
 * the app-level {@link ConnectionRegistry} and is addressed per request by
 * `connectionId`; per-client identity travels on the tool request context
 * (`ToolExecutionContext.clientInfo`), so this object holds no per-client
 * state and has no lifecycle of its own.
 */
export class ServerServices {
    readonly config: UserConfig;
    readonly keychain: Keychain;
    readonly logger: CompositeLogger;
    readonly connectionRegistry: ConnectionRegistry;
    readonly exportsManager: ExportsManager;
    readonly apiClient: ApiClient;
    readonly atlasLocalClient?: Client;
    readonly connectionErrorHandler: ConnectionErrorHandler;

    constructor({
        config,
        logger,
        keychain,
        connectionRegistry,
        exportsManager,
        atlasLocalClient,
        connectionErrorHandler,
        apiClient,
    }: ServerServicesOptions) {
        this.config = config;
        this.keychain = keychain;
        this.logger = logger;
        this.connectionRegistry = connectionRegistry;
        this.exportsManager = exportsManager;
        this.atlasLocalClient = atlasLocalClient;
        this.connectionErrorHandler = connectionErrorHandler;
        this.apiClient = apiClient;
    }
}
