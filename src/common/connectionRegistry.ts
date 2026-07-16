import { randomBytes } from "crypto";
import { ConnectionString } from "mongodb-connection-string-url";
import { getRandomUUID } from "../helpers/getRandomUUID.js";
import type { NodeDriverServiceProvider } from "@mongosh/service-provider-node-driver";
import { generateConnectionInfoFromCliArgs } from "@mongosh/arg-parser";
import type { DeviceId } from "../helpers/deviceId.js";
import type { LoggerBase } from "./logging/index.js";
import { LogId } from "./logging/index.js";
import type { UserConfig } from "./config/userConfig.js";
import type { AnyConnectionState, ConnectionManager, ConnectionSettings } from "./connectionManager.js";
import { MCPConnectionManager } from "./connectionManager.js";
import { ErrorCodes, MongoDBError } from "./errors.js";

/**
 * The reserved, well-known id of the connection seeded from the `connectionString`
 * config option. Deliberately has no random suffix: it is meant to be citable in
 * docs and tool descriptions, there is exactly one per server, and guessing it on
 * a server without a configured connection string fails with an instructive error.
 */
export const PRECONFIGURED_CONNECTION_ID = "preconfigured";

const NAME_SUFFIX_BYTES = 2;
const MAX_SLUG_LENGTH = 40;

export type ConnectionSource = "explicit" | "preconfigured";

export type CreateConnectionEntryOptions = {
    /**
     * Label for the connection — e.g. a host or cluster name. Stored on the
     * entry slugified and disambiguated with a short random suffix, and
     * surfaced in connection listings. Labels are not identifiers: connections
     * are only ever addressed by their opaque connectionId.
     */
    name: string;
    /**
     * Name of the MCP client the connection is established for; embedded in
     * the driver `appName` so connections are attributable in server logs.
     */
    clientName?: string;
    /**
     * Cleanup invoked when the connection is revoked (explicit disconnect,
     * connection-limit overflow, or store shutdown) — e.g. deleting
     * credentials provisioned for the connection. Runs at most once; failures
     * are logged, never thrown.
     */
    onRevoke?: () => Promise<void>;
};

export type CreateConnectionOptions = {
    /** The connection string and driver options to dial with. */
    settings: ConnectionSettings;
    /**
     * Optional label for the connection. Stored on the entry slugified and
     * disambiguated with a short random suffix, and surfaced in connection
     * listings. Generated from the Atlas cluster name or the connection
     * string's host when omitted. Labels are not identifiers: connections are
     * only ever addressed by their opaque connectionId.
     */
    name?: string;
    /**
     * Name of the MCP client the connection is established for; embedded in
     * the driver `appName` so connections are attributable in server logs.
     */
    clientName?: string;
};

/**
 * A named collection of MongoDB connections addressed by opaque connection
 * ids ("handles"). Consumers establish connections via
 * {@link ConnectionRegistry.connect} (or {@link ConnectionRegistry.createEntry}
 * when they drive the dialing themselves) and refer to them everywhere else by
 * the returned entry's id.
 *
 * A registry is always fully bound to the connections it can see: instances
 * are obtained from {@link MCPConnectionStore.view} (which fixes the
 * visibility scope at creation time) or supplied by an embedder. Consequently
 * no method takes any notion of caller identity, scope, or context.
 *
 * Every method is asynchronous: implementations may hold entries in memory
 * (like the default store) or back them with external storage, doing I/O on
 * each lookup.
 */
export interface ConnectionRegistry {
    /** Creates an entry without dialing it, for callers that drive the dial themselves (e.g. retrying connect flows). */
    createEntry(opts: CreateConnectionEntryOptions): Promise<ConnectionEntry>;
    /** Creates an entry and dials it. A failed dial leaves no entry behind. */
    connect(opts: CreateConnectionOptions): Promise<ConnectionEntry>;
    /** Looks up an entry and marks it as used. */
    get(connectionId: string): Promise<ConnectionEntry | undefined>;
    /** Looks up an entry without affecting LRU ordering (telemetry, error handling). */
    peek(connectionId: string): Promise<ConnectionEntry | undefined>;
    /** Entries matching a predicate, without affecting LRU ordering. */
    find(predicate: (entry: ConnectionEntry) => boolean): Promise<ConnectionEntry[]>;
    /** Resolves a handle to a live service provider; throws `UnknownConnectionId` for absent handles. */
    resolve(connectionId: string): Promise<NodeDriverServiceProvider>;
    /**
     * Closes the identified connection. Explicit entries are revoked — the
     * connectionId stops resolving; the preconfigured entry is closed but
     * remains available and re-dials on next use. Throws `UnknownConnectionId`
     * for absent handles, like {@link ConnectionRegistry.resolve}.
     */
    disconnect(connectionId: string): Promise<void>;
    /** Disconnects every entry reachable through this registry object. */
    closeAll(): Promise<void>;
}

type ConnectionEntryOptions = {
    connectionId: string;
    name: string;
    source: ConnectionSource;
    manager: ConnectionManager;
    onRevoke?: () => Promise<void>;
};

/**
 * A named connection held by a {@link ConnectionRegistry}. Each entry owns its
 * own {@link ConnectionManager} (dialing, state machine, OIDC handling), so the
 * registry is a collection of independent connection lifecycles keyed by handle.
 */
export class ConnectionEntry {
    /**
     * The opaque handle the connection is addressed by — a UUID with no
     * derivable structure. The one exception is the preconfigured entry, whose
     * id is the well-known literal "preconfigured".
     */
    readonly connectionId: string;
    /**
     * Human/model-readable label: the supplied or generated name, slugified
     * and suffixed for disambiguation (e.g. `my-project-cluster0-4f2a`).
     */
    readonly name: string;
    readonly source: ConnectionSource;
    readonly createdAt: Date = new Date();
    lastUsedAt: Date = new Date();
    lastError?: string;

    /** Revocation cleanup armed at creation; see {@link CreateConnectionEntryOptions.onRevoke}. */
    private onRevoke?: () => Promise<void>;

    private readonly manager: ConnectionManager;

    constructor({ connectionId, name, source, manager, onRevoke }: ConnectionEntryOptions) {
        this.connectionId = connectionId;
        this.name = name;
        this.source = source;
        this.manager = manager;
        this.onRevoke = onRevoke;
    }

    get state(): AnyConnectionState {
        return this.manager.currentConnectionState;
    }

    /**
     * Invokes the revocation cleanup supplied at creation and disarms it, so
     * the cleanup runs at most once even when triggered both directly and by
     * a later revocation.
     */
    async runRevokeCleanup(): Promise<void> {
        const onRevoke = this.onRevoke;
        this.onRevoke = undefined;
        await onRevoke?.();
    }

    async connect(settings: ConnectionSettings): Promise<AnyConnectionState> {
        try {
            const state = await this.manager.connect({ ...settings });
            this.lastError = undefined;
            return state;
        } catch (error: unknown) {
            this.lastError = error instanceof Error ? error.message : String(error);
            throw error;
        }
    }

    /**
     * Returns the live service provider or throws a `NotConnectedToMongoDB` error
     * describing why the entry is not usable (Atlas dial still in progress, OIDC
     * flow pending, or plain not connected).
     */
    getServiceProvider(): NodeDriverServiceProvider {
        const state = this.state;
        if (state.tag === "connected") {
            return state.serviceProvider;
        }

        if (state.connectedAtlasCluster && (state.tag === "connecting" || state.tag === "disconnected")) {
            throw new MongoDBError(
                ErrorCodes.NotConnectedToMongoDB,
                `Connection "${this.connectionId}" is still being established to Atlas cluster "${state.connectedAtlasCluster.clusterName}", try again in a few seconds.`
            );
        }

        throw new MongoDBError(ErrorCodes.NotConnectedToMongoDB, `Connection "${this.connectionId}" is not connected.`);
    }

    async isSearchSupported(logger: LoggerBase): Promise<boolean> {
        const state = this.state;
        if (state.tag === "connected") {
            return state.isSearchSupported(logger);
        }
        return false;
    }

    async assertSearchSupported(logger: LoggerBase): Promise<void> {
        if (!(await this.isSearchSupported(logger))) {
            throw new MongoDBError(
                ErrorCodes.AtlasSearchNotSupported,
                "Atlas Search is not supported in the current cluster."
            );
        }
    }

    async close(): Promise<void> {
        await this.manager.close();
    }
}

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
     * `closeAll()` on the returned registry disconnects only the entries it
     * can reach; the preconfigured entry is closed-but-kept per its usual
     * disconnect semantics.
     */
    view(scope?: string): ConnectionRegistry {
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

            find: (predicate: (entry: ConnectionEntry) => boolean): Promise<ConnectionEntry[]> =>
                Promise.resolve(
                    [...this.entries.values()]
                        .filter((stored) => visible(stored) && predicate(stored.entry))
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

            closeAll: async (): Promise<void> => {
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
        for (;;) {
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
        await entry.close().catch(() => undefined);
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

/**
 * Slug source for Atlas cluster handles: `<projectName>-<clusterName>`.
 * Cluster names are only unique within a project, so the project name
 * disambiguates; when the combination exceeds the slug budget, the project
 * half is truncated first so the cluster name always survives.
 */
export function atlasClusterSlug(projectName: string | undefined, clusterName: string): string {
    const clusterSlug = slugify(clusterName);
    const projectSlug = projectName
        ? slugify(projectName).slice(0, Math.max(0, MAX_SLUG_LENGTH - clusterSlug.length - 1))
        : "";
    return projectSlug ? `${projectSlug}-${clusterSlug}` : clusterSlug;
}

function buildEntryName(rawName: string): string {
    // Names with no alphanumeric characters slugify to the empty string.
    const slug = slugify(rawName) || "connection";
    return `${slug}-${randomBytes(NAME_SUFFIX_BYTES).toString("hex")}`;
}

/**
 * Reduces a label to lowercase alphanumerics separated by single hyphens
 * (e.g. `My Project/Cluster0` → `my-project-cluster0`), capped at
 * {@link MAX_SLUG_LENGTH}. Can return the empty string if the label contains
 * no alphanumeric characters.
 */
function slugify(value: string): string {
    // After the collapsing replace, hyphens never repeat, so trimming a single
    // leading/trailing hyphen is complete — and keeps the trim regexes free of
    // quantifiers that backtrack polynomially on untrusted input.
    return value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, MAX_SLUG_LENGTH)
        .replace(/-$/, "");
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
