import { EventEmitter } from "events";
import type { NodeDriverServiceProvider } from "@mongosh/service-provider-node-driver";
import type { DeviceId } from "../helpers/deviceId.js";
import type { UserConfig } from "./config/userConfig.js";
import { ErrorCodes, MongoDBError } from "./errors.js";
import { type LoggerBase, LogId } from "./logging/index.js";
import { buildServiceProvider, type ConnectionSettings } from "./connectionManager.js";
import type { ConnectionStringInfo } from "./connectionInfo.js";

/** Lifecycle status of a single named connection in the registry. */
export type ConnectionRegistryEntryStatus = "idle" | "connecting" | "connected" | "errored";

interface ConnectionRegistryEntry {
    name: string;
    settings: ConnectionSettings;
    /**
     * The in-flight or settled connect promise. Stored before it settles so
     * concurrent first-callers share a single physical connect. Cleared on
     * failure so a later call can retry.
     */
    provider?: Promise<NodeDriverServiceProvider>;
    status: ConnectionRegistryEntryStatus;
    connectionStringInfo?: ConnectionStringInfo;
}

export interface ConnectionRegistryOptions {
    userConfig: UserConfig;
    deviceId: DeviceId;
    logger: LoggerBase;
    /**
     * Lazily resolves the current MCP client name for the connection's
     * `appName`. Read at resolve time because the client name is only known
     * after the MCP client initialises the session.
     */
    getClientName: () => string;
    /** Parsed named-connection targets, keyed by connection name. */
    connections?: Record<string, { connectionString: string }>;
    /** Name of the entry that acts as the session default, when any. */
    defaultConnectionName?: string;
}

/**
 * Resolves the name of the registry entry that should act as the session
 * default, following the precedence: legacy `connectionString` (folded into the
 * reserved `"default"` entry) → explicit `defaultConnection` → a literal
 * `"default"` key in the connections map → none.
 */
export function resolveDefaultConnectionName(config: UserConfig): string | undefined {
    if (config.connectionString) {
        return "default";
    }
    if (config.defaultConnection) {
        return config.defaultConnection;
    }
    if (config.connections && Object.prototype.hasOwnProperty.call(config.connections, "default")) {
        return "default";
    }
    return undefined;
}

/**
 * A lazy, keyed pool of named {@link NodeDriverServiceProvider}s that coexists
 * with — and never mutates — the single-slot session-default connection managed
 * by {@link import("./connectionManager.js").MCPConnectionManager}.
 *
 * This implements the MCP "explicit-handle" pattern: the handle is the
 * connection **name**, supplied per tool call. When a name is supplied nothing
 * shared is mutated, which is what makes a single session safe to share behind
 * a gateway. Each name owns one long-lived provider (the driver is itself a
 * concurrency-safe pool); first-use races collapse to a single connect via the
 * stored in-flight promise.
 */
export class ConnectionRegistry {
    private readonly entries = new Map<string, ConnectionRegistryEntry>();
    private readonly userConfig: UserConfig;
    private readonly deviceId: DeviceId;
    private readonly logger: LoggerBase;
    private readonly getClientName: () => string;
    /** Name of the entry backing the session default, when any. */
    public readonly defaultName?: string;

    constructor({
        userConfig,
        deviceId,
        logger,
        getClientName,
        connections,
        defaultConnectionName,
    }: ConnectionRegistryOptions) {
        this.userConfig = userConfig;
        this.deviceId = deviceId;
        this.logger = logger;
        this.getClientName = getClientName;
        this.defaultName = defaultConnectionName;

        for (const [name, target] of Object.entries(connections ?? {})) {
            this.entries.set(name, {
                name,
                settings: { connectionString: target.connectionString },
                status: "idle",
            });
        }
    }

    /** Whether a connection with the given name is configured. */
    public has(name: string): boolean {
        return this.entries.has(name);
    }

    /** Names of all configured connections. */
    public names(): string[] {
        return [...this.entries.keys()];
    }

    /** Current lifecycle status of a named connection, or undefined when unknown. */
    public statusOf(name: string): ConnectionRegistryEntryStatus | undefined {
        return this.entries.get(name)?.status;
    }

    /** The {@link ConnectionSettings} for a named connection, or undefined when unknown. */
    public getSettings(name: string): ConnectionSettings | undefined {
        return this.entries.get(name)?.settings;
    }

    /**
     * Lazily establishes (or returns the already-established) provider for the
     * named connection. Concurrent first-callers share a single physical
     * connect. Never touches the session-default connection.
     *
     * @throws {@link MongoDBError} with {@link ErrorCodes.NamedConnectionNotFound}
     * when the name is unknown, or {@link ErrorCodes.NamedConnectionFailed} when
     * establishing the connection fails. Both codes bypass the session-default
     * connection recovery handler.
     */
    public async resolve(name: string): Promise<NodeDriverServiceProvider> {
        const entry = this.entries.get(name);
        if (!entry) {
            throw new MongoDBError(
                ErrorCodes.NamedConnectionNotFound,
                `Connection "${name}" is not configured. Available connections: ${this.formatNames()}.`
            );
        }

        if (entry.provider) {
            return entry.provider;
        }

        entry.status = "connecting";
        const providerPromise = this.establish(entry).then(
            (provider) => {
                entry.status = "connected";
                return provider;
            },
            (error: unknown) => {
                entry.status = "errored";
                // Allow a later call to retry a failed connection.
                entry.provider = undefined;
                throw error instanceof MongoDBError
                    ? error
                    : new MongoDBError(
                          ErrorCodes.NamedConnectionFailed,
                          `Failed to establish connection "${name}": ${error instanceof Error ? error.message : String(error)}`
                      );
            }
        );
        // Store the promise BEFORE awaiting so N concurrent first-callers share it.
        entry.provider = providerPromise;
        return providerPromise;
    }

    private async establish(entry: ConnectionRegistryEntry): Promise<NodeDriverServiceProvider> {
        this.logger.debug({
            id: LogId.mongodbConnectTry,
            context: "connectionRegistry",
            message: `Establishing named connection "${entry.name}"`,
        });

        const { serviceProvider, connectionStringInfo } = await buildServiceProvider(entry.settings, {
            userConfig: this.userConfig,
            deviceId: this.deviceId,
            clientName: this.getClientName(),
            bus: new EventEmitter(),
        });

        entry.connectionStringInfo = connectionStringInfo;
        return serviceProvider;
    }

    /** Closes every established provider (best-effort) and resets all entries to idle. */
    public async close(): Promise<void> {
        const pending = [...this.entries.values()]
            .map((entry) => entry.provider)
            .filter((provider): provider is Promise<NodeDriverServiceProvider> => provider !== undefined);

        for (const entry of this.entries.values()) {
            entry.provider = undefined;
            entry.status = "idle";
        }

        await Promise.allSettled(
            pending.map(async (providerPromise) => {
                try {
                    const provider = await providerPromise;
                    await provider.close();
                } catch (error: unknown) {
                    this.logger.warning({
                        id: LogId.mongodbDisconnectFailure,
                        context: "connectionRegistry",
                        message: `Error closing a named connection: ${error instanceof Error ? error.message : String(error)}`,
                    });
                }
            })
        );
    }

    private formatNames(): string {
        const names = this.names();
        return names.length > 0 ? names.map((name) => `"${name}"`).join(", ") : "none";
    }
}
