import { getRandomUUID, LogId } from "@mongodb-js/mcp-core";
import type { LoggerBase } from "@mongodb-js/mcp-core";
import type { NodeDriverServiceProvider } from "@mongosh/service-provider-node-driver";
import { ConnectionString } from "mongodb-connection-string-url";
import { generateConnectionInfoFromCliArgs } from "@mongosh/arg-parser";
import type { DeviceId } from "../helpers/deviceId.js";
import type { ServerMetadata } from "@mongodb-js/mcp-types";
import type { ConnectionInfo } from "./connectionInfo.js";
import type { ConnectionDriverConfig, ConnectionManager } from "./connectionManager.js";
import { MCPConnectionManager } from "./connectionManager.js";
import { ErrorCodes, MongoDBError } from "./errors.js";
import type {
    ConnectionRegistry,
    CreateConnectionEntryOptions,
    CreateConnectionOptions,
} from "./connectionRegistry.js";
import { buildEntryName, ConnectionEntry, PRECONFIGURED_CONNECTION_ID } from "./connectionRegistry.js";

/**
 * Structural subset of the embedder's configuration that the store reads: the
 * store-level knobs plus every config field mongosh's arg-parser maps into
 * the derived connection string / driver options
 * ({@link ConnectionDriverConfig}), so tool-initiated connects apply the
 * server's auth/OIDC/TLS configuration exactly like the preconfigured dial.
 *
 * Kept structural so the embedder's full config satisfies this shape without
 * the store depending on it directly.
 */
export type ConnectionStoreConfig = ConnectionDriverConfig & {
    connectionString?: string;
    maxActiveConnections: number;
    transport: "stdio" | "http";
    httpHost: string;
};

/**
 * Fallback server metadata used when the embedder does not supply any. The cli
 * normally passes richer metadata through the session; embedders that care
 * about driver `appName` attribution should pass `serverMetadata` in
 * {@link ConnectionStoreOptions}.
 */
const DEFAULT_SERVER_METADATA: ServerMetadata = {
    mcpServerName: "mongodb-mcp-server",
    version: "0.0.0",
};

export type ConnectionStoreOptions = {
    /**
     * Connection-level configuration the store reads: the preconfigured
     * connection string, per-scope connection limit, transport, and OIDC
     * browser hint.
     */
    options: ConnectionStoreConfig;
    logger: LoggerBase;
    deviceId: DeviceId;
    /** Server metadata embedded in the driver `appName`; a generic default is used when omitted. */
    serverMetadata?: ServerMetadata;
};

type StoredConnection = {
    entry: ConnectionEntry;
    /**
     * Visibility scope the entry was created under; `undefined` means shared
     * (the preconfigured entry, or entries created through an unbound view).
     * Store bookkeeping — deliberately not exposed on the entry itself.
     */
    scope?: string;
};

/**
 * Owns the app-level storage and lifecycle of MongoDB connection handles: the
 * entry map, the preconfigured entry seeded from a configured connection
 * string, per-scope connection limits, and shutdown. Consumers never hold the
 * store directly — they access entries through {@link ConnectionRegistry}
 * views minted with {@link MCPConnectionStore.view}.
 */
export class MCPConnectionStore {
    private readonly entries = new Map<string, StoredConnection>();
    private readonly options: ConnectionStoreConfig;
    private readonly logger: LoggerBase;
    private readonly deviceId: DeviceId;
    private readonly serverMetadata: ServerMetadata;
    private preconfiguredDial?: Promise<unknown>;

    constructor(options: ConnectionStoreOptions) {
        this.options = options.options;
        this.logger = options.logger;
        this.deviceId = options.deviceId;
        this.serverMetadata = options.serverMetadata ?? DEFAULT_SERVER_METADATA;

        if (this.options.connectionString) {
            this.entries.set(PRECONFIGURED_CONNECTION_ID, {
                entry: new ConnectionEntry({
                    connectionId: PRECONFIGURED_CONNECTION_ID,
                    name: PRECONFIGURED_CONNECTION_ID,
                    source: "preconfigured",
                    manager: this.createConnectionManager(),
                }),
            });
        }
    }

    /**
     * Transport / browser hints for OIDC auth-type inference, derived from the
     * subset of the user config the store is given.
     */
    private connectionInfo(): ConnectionInfo {
        return {
            transport: this.options.transport,
            httpHost: this.options.httpHost,
            browser: this.options.browser,
        };
    }

    /**
     * Creates the per-entry {@link ConnectionManager} the store seeds and
     * dials with. Override in a subclass to supply a custom implementation
     * (tests, embedders) — the default dials with
     * {@link MCPConnectionManager} configured from the store's options.
     * Invoked from the constructor when a preconfigured connection string is
     * present, so overrides must not rely on subclass state initialized after
     * `super()`.
     */
    protected createConnectionManager(): ConnectionManager {
        return new MCPConnectionManager({
            logger: this.logger,
            deviceId: this.deviceId,
            serverMetadata: this.serverMetadata,
            connectionInfo: this.connectionInfo(),
            // The store options are a ConnectionDriverConfig superset;
            // the extra store-level fields (connectionString,
            // maxActiveConnections, transport, httpHost) are not read
            // by mongosh's arg-parser, so passing the whole object is
            // equivalent to passing just the driver fields.
            driverConfig: this.options,
        });
    }

    /**
     * Returns a {@link ConnectionRegistry} over this store. When `scope` is
     * provided, entries created through the returned registry are tagged with
     * it and the registry only surfaces entries of that scope plus shared ones
     * (`entry.scope === undefined`, e.g. the preconfigured entry) — invisible
     * handles behave exactly like absent ones. When `scope` is omitted, the
     * registry sees every entry and creates shared ones.
     *
     * `owned` controls what {@link ConnectionRegistry.close} does: an owned
     * registry disconnects every entry it can reach (the preconfigured entry
     * is closed-but-kept per its usual disconnect semantics), an unowned one
     * does nothing. It defaults to whether the view is scoped: scoped entries
     * are unreachable once their scope holder is gone, while an unbound view's
     * entries are shared and must outlive it.
     */
    view({ scope, owned = scope !== undefined }: { scope?: string; owned?: boolean } = {}): ConnectionRegistry {
        const visible = (stored: StoredConnection | undefined): stored is StoredConnection =>
            stored !== undefined && (scope === undefined || stored.scope === undefined || stored.scope === scope);

        const peek = (connectionId: string): Promise<ConnectionEntry | undefined> => {
            const stored = this.entries.get(connectionId);
            return Promise.resolve(visible(stored) ? stored.entry : undefined);
        };

        const get = async (connectionId: string): Promise<ConnectionEntry | undefined> => {
            const entry = await peek(connectionId);
            if (entry) {
                entry.lastUsedAt = new Date();
            }
            return entry;
        };

        const disconnect = async (connectionId: string): Promise<void> => {
            const entry = await peek(connectionId);
            if (!entry) {
                throw new MongoDBError(
                    ErrorCodes.UnknownConnectionId,
                    `Connection "${connectionId}" does not exist or has expired.`
                );
            }
            if (entry.source === "preconfigured") {
                await entry.close();
                return;
            }
            await this.revoke(entry);
        };

        return {
            createEntry: (opts: CreateConnectionEntryOptions): Promise<ConnectionEntry> =>
                Promise.resolve(this.addEntry({ ...opts, scope })),

            connect: async ({ settings, name, clientName }: CreateConnectionOptions): Promise<ConnectionEntry> => {
                name ??= settings.atlas?.clusterName ?? hostFromConnectionString(settings.connectionString);
                const entry = this.addEntry({ name, clientName, scope });
                try {
                    await entry.connect(settings);
                } catch (error: unknown) {
                    this.entries.delete(entry.connectionId);
                    await entry.close().catch(() => undefined);
                    throw error;
                }
                await this.enforceLimit(scope);
                return entry;
            },

            get,
            peek,

            find: (predicate?: (entry: ConnectionEntry) => boolean): Promise<ConnectionEntry[]> =>
                Promise.resolve(
                    [...this.entries.values()]
                        .filter((stored) => visible(stored) && (predicate?.(stored.entry) ?? true))
                        .map((stored) => stored.entry)
                ),

            resolve: async (connectionId: string): Promise<NodeDriverServiceProvider> => {
                const entry = await get(connectionId);
                if (!entry) {
                    throw new MongoDBError(
                        ErrorCodes.UnknownConnectionId,
                        `Connection "${connectionId}" does not exist or has expired.`
                    );
                }

                if (
                    entry.source === "preconfigured" &&
                    (entry.state.tag === "disconnected" || entry.state.tag === "errored")
                ) {
                    await this.dialPreconfigured(entry);
                }

                return entry.getServiceProvider();
            },

            disconnect,

            close: async (): Promise<void> => {
                if (!owned) {
                    return;
                }
                const reachable = [...this.entries.values()].filter((stored) =>
                    scope === undefined ? true : stored.scope === scope
                );
                await Promise.allSettled(reachable.map((stored) => disconnect(stored.entry.connectionId)));
            },
        };
    }

    /** Closes and removes every entry, including the preconfigured one. For process/runner shutdown. */
    async closeAll(): Promise<void> {
        const stored = [...this.entries.values()];
        this.entries.clear();
        await Promise.allSettled(stored.map(({ entry }) => this.revoke(entry)));
    }

    private addEntry({
        name,
        clientName,
        scope,
        onRevoke,
    }: CreateConnectionEntryOptions & { scope?: string }): ConnectionEntry {
        const manager = this.createConnectionManager();
        if (clientName) {
            manager.setClientName(clientName);
        }

        const entry = new ConnectionEntry({
            connectionId: getRandomUUID(),
            name: buildEntryName(name),
            source: "explicit",
            manager,
            onRevoke,
        });
        this.entries.set(entry.connectionId, { entry, scope });
        void this.enforceLimit(scope);
        return entry;
    }

    private async dialPreconfigured(entry: ConnectionEntry): Promise<void> {
        this.preconfiguredDial ??= (async (): Promise<void> => {
            const connectionInfo = generateConnectionInfoFromCliArgs({
                // Same rationale as in the constructor: mongosh only consumes
                // known CLI-option keys, so spreading the whole store config is
                // fine and keeps the preconfigured dial on equal footing with
                // tool-initiated connects.
                ...this.options,
                connectionSpecifier: this.options.connectionString,
            });
            await entry.connect(connectionInfo);
        })().finally(() => {
            this.preconfiguredDial = undefined;
        });

        try {
            await this.preconfiguredDial;
        } catch (error: unknown) {
            this.logger.error({
                id: LogId.connectionRegistryDialFailure,
                context: "connectionRegistry",
                message: `Failed to connect using the configured connection string: ${error as string}`,
            });
            throw new MongoDBError(
                ErrorCodes.MisconfiguredConnectionString,
                "The configured connection string is not valid or the server is unreachable."
            );
        }
    }

    /**
     * Enforces `maxActiveConnections` per scope, counting explicit entries only
     * (the preconfigured entry is pinned). Per-scope counting means one scope
     * (e.g. session) cannot evict another's handles.
     */
    private async enforceLimit(scope: string | undefined): Promise<void> {
        while (true) {
            const scoped = [...this.entries.values()].filter(
                (stored) => stored.entry.source !== "preconfigured" && stored.scope === scope
            );
            if (scoped.length <= this.options.maxActiveConnections) {
                return;
            }
            const lru = scoped.sort((a, b) => a.entry.lastUsedAt.getTime() - b.entry.lastUsedAt.getTime())[0];
            if (!lru) {
                return;
            }
            this.logger.info({
                id: LogId.connectionRegistryRevoked,
                context: "connectionRegistry",
                message: `Revoking least-recently-used connection "${lru.entry.connectionId}" because its scope exceeded ${this.options.maxActiveConnections} connections.`,
            });
            this.entries.delete(lru.entry.connectionId);
            await this.revoke(lru.entry);
        }
    }

    private async revoke(entry: ConnectionEntry): Promise<void> {
        this.entries.delete(entry.connectionId);
        try {
            await entry.close();
        } catch {
            // best-effort, don't throw on close failure, the entry is already removed from the store
        }

        try {
            await entry.runRevokeCleanup();
        } catch (error: unknown) {
            this.logger.error({
                id: LogId.connectionRegistryRevokeCallbackFailure,
                context: "connectionRegistry",
                message: `Revocation cleanup for connection "${entry.connectionId}" failed: ${error as string}`,
            });
        }
    }
}

/** The first host of the connection string (without port), as a slug source for generated names. */
function hostFromConnectionString(connectionString: string | undefined): string {
    if (!connectionString) {
        return "connection";
    }

    try {
        const host = new ConnectionString(connectionString, { looseValidation: true }).hosts[0];
        return host?.split(":")[0] || "connection";
    } catch {
        return "connection";
    }
}
