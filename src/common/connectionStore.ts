import { getRandomUUID } from "../helpers/getRandomUUID.js";
import type { NodeDriverServiceProvider } from "@mongosh/service-provider-node-driver";
import { ConnectionString } from "mongodb-connection-string-url";
import { generateConnectionInfoFromCliArgs } from "@mongosh/arg-parser";
import type { DeviceId } from "../helpers/deviceId.js";
import type { LoggerBase } from "./logging/index.js";
import { LogId } from "./logging/index.js";
import type { UserConfig } from "./config/userConfig.js";
import type { ConnectionManager } from "./connectionManager.js";
import { MCPConnectionManager } from "./connectionManager.js";
import { ErrorCodes, MongoDBError } from "./errors.js";
import type {
    ConnectionRegistry,
    CreateConnectionEntryOptions,
    CreateConnectionOptions,
} from "./connectionRegistry.js";
import { buildEntryName, ConnectionEntry, PRECONFIGURED_CONNECTION_ID } from "./connectionRegistry.js";

export type CreateConnectionManagerFn = () => ConnectionManager;

export type ConnectionStoreOptions = {
    userConfig: UserConfig;
    logger: LoggerBase;
    deviceId: DeviceId;
    /** Override the per-entry connection manager (tests, embedders). */
    createConnectionManager?: CreateConnectionManagerFn;
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
    private readonly userConfig: UserConfig;
    private readonly logger: LoggerBase;
    private readonly createConnectionManager: CreateConnectionManagerFn;
    private preconfiguredDial?: Promise<unknown>;

    constructor(options: ConnectionStoreOptions) {
        this.userConfig = options.userConfig;
        this.logger = options.logger;
        this.createConnectionManager =
            options.createConnectionManager ??
            ((): ConnectionManager => new MCPConnectionManager(options.userConfig, options.logger, options.deviceId));

        if (this.userConfig.connectionString) {
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
                ...this.userConfig,
                connectionSpecifier: this.userConfig.connectionString,
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
            if (scoped.length <= this.userConfig.maxActiveConnections) {
                return;
            }
            const lru = scoped.sort((a, b) => a.entry.lastUsedAt.getTime() - b.entry.lastUsedAt.getTime())[0];
            if (!lru) {
                return;
            }
            this.logger.info({
                id: LogId.connectionRegistryRevoked,
                context: "connectionRegistry",
                message: `Revoking least-recently-used connection "${lru.entry.connectionId}" because its scope exceeded ${this.userConfig.maxActiveConnections} connections.`,
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
