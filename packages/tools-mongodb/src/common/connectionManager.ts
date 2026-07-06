import { EventEmitter } from "events";
import { MongoServerError } from "mongodb";
import { NodeDriverServiceProvider } from "@mongosh/service-provider-node-driver";
import { generateConnectionInfoFromCliArgs, type ConnectionInfo as MongoshConnectionInfo } from "@mongosh/arg-parser";
import type { DeviceId } from "../helpers/deviceId.js";
import { MongoDBError, ErrorCodes } from "./errors.js";
import { type LoggerBase, LogId } from "@mongodb-js/mcp-core";
import { type AppNameComponents, setAppNameParamIfMissing } from "../helpers/connectionOptions.js";
import {
    getConnectionStringInfo,
    type ConnectionStringInfo,
    type AtlasClusterConnectionInfo,
    type ConnectionInfo,
} from "./connectionInfo.js";
import type { ServerMetadata } from "@mongodb-js/mcp-types";

export type { ConnectionStringInfo, ConnectionStringAuthType, AtlasClusterConnectionInfo } from "./connectionInfo.js";

export interface ConnectionSettings extends MongoshConnectionInfo {
    atlas?: AtlasClusterConnectionInfo;
}

export type ConnectionTag = "connected" | "connecting" | "disconnected" | "errored";
export type OIDCConnectionAuthType = "oidc-auth-flow" | "oidc-device-flow";

export interface ConnectionState {
    tag: ConnectionTag;
    connectionStringInfo?: ConnectionStringInfo;
    connectedAtlasCluster?: AtlasClusterConnectionInfo;
}

const SEARCH_PROBE_COLLECTION_NAME = "test";

/** See https://github.com/mongodb/mongo/blob/master/src/mongo/base/error_codes.yml (SearchNotEnabled). */
const MONGODB_SEARCH_NOT_ENABLED_ERROR_CODE = 31082;

export const defaultDriverOptions: MongoshConnectionInfo["driverOptions"] = {
    readConcern: {
        level: "local",
    },
    readPreference: "secondaryPreferred",
    writeConcern: {
        w: "majority",
    },
    timeoutMS: 30_000,
    proxy: { useEnvironmentVariableProxies: true },
    applyProxyToOIDC: true,
};

export class ConnectionStateConnected implements ConnectionState {
    public tag = "connected" as const;

    public serviceProvider: NodeDriverServiceProvider;
    public connectionStringInfo?: ConnectionStringInfo;
    public connectedAtlasCluster?: AtlasClusterConnectionInfo;

    constructor({
        serviceProvider,
        connectionStringInfo,
        connectedAtlasCluster,
    }: {
        serviceProvider: NodeDriverServiceProvider;
        connectionStringInfo?: ConnectionStringInfo;
        connectedAtlasCluster?: AtlasClusterConnectionInfo;
    }) {
        this.serviceProvider = serviceProvider;
        this.connectionStringInfo = connectionStringInfo;
        this.connectedAtlasCluster = connectedAtlasCluster;
    }

    private _isSearchSupported?: boolean;

    public async isSearchSupported(logger: LoggerBase): Promise<boolean> {
        if (this._isSearchSupported === undefined) {
            this._isSearchSupported = await this.probeSearchCapability(logger);
        }

        return this._isSearchSupported;
    }

    private async probeSearchCapability(logger: LoggerBase): Promise<boolean> {
        const databases = await this.buildSearchProbeDatabaseCandidates(logger);

        for (const databaseName of databases) {
            try {
                await this.serviceProvider.getSearchIndexes(databaseName, SEARCH_PROBE_COLLECTION_NAME);
                logger.debug({
                    id: LogId.searchCapabilityProbe,
                    context: "ConnectionStateConnected",
                    message: "Atlas Search capability probe succeeded",
                });
                return true;
            } catch (probeError: unknown) {
                if (
                    probeError instanceof MongoServerError &&
                    (probeError.code === MONGODB_SEARCH_NOT_ENABLED_ERROR_CODE ||
                        probeError.codeName === "SearchNotEnabled")
                ) {
                    logger.debug({
                        id: LogId.searchCapabilityProbe,
                        context: "ConnectionStateConnected",
                        message: "Atlas Search capability probe: search not enabled on cluster",
                    });

                    return false;
                }

                logger.debug({
                    id: LogId.searchCapabilityProbe,
                    context: "ConnectionStateConnected",
                    message: "Atlas Search capability probe: inconclusive error for database candidate, trying next",
                });
            }
        }

        logger.debug({
            id: LogId.searchCapabilityProbe,
            context: "ConnectionStateConnected",
            message: "Atlas Search capability probe: no success and no SearchNotEnabled; assuming search is supported",
        });

        return true;
    }

    /**
     * Build an ordered list of database names to try for the search index probe.
     * Prefers the driver's initial database from the connection string (when not
     * a system DB), then other non-system databases from listDatabases, then the
     * fallback #mongodb-mcp database.
     */
    private async buildSearchProbeDatabaseCandidates(logger: LoggerBase): Promise<string[]> {
        type ListDatabasesDocument = { databases?: { name?: string }[] };
        let listedNames: string[] = [];
        try {
            const raw = (await this.serviceProvider.listDatabases("")) as ListDatabasesDocument;
            const rows = raw.databases;
            if (Array.isArray(rows)) {
                listedNames = rows
                    .map((row) => row.name)
                    .filter((name): name is string => typeof name === "string" && name.length > 0);
            }
        } catch {
            logger.debug({
                id: LogId.searchCapabilityProbe,
                context: "ConnectionStateConnected",
                message: "listDatabases failed while building Atlas Search probe candidates",
            });
        }

        // System databases that should be skipped when searching for accessible databases
        const SYSTEM_DATABASES = new Set(["admin", "local", "config"]);

        const nonSystem = listedNames
            .filter((name) => !SYSTEM_DATABASES.has(name))
            .slice(0, 10)
            .sort((a, b) => a.localeCompare(b));

        const result = new Set<string>();
        const initialDb = this.serviceProvider.initialDb;
        if (initialDb.length > 0 && !SYSTEM_DATABASES.has(initialDb)) {
            result.add(initialDb);
        }

        for (const name of nonSystem) {
            result.add(name);
        }

        result.add("#mongodb-mcp");

        return [...result];
    }
}

export interface ConnectionStateConnecting extends ConnectionState {
    tag: "connecting";
    serviceProvider: Promise<NodeDriverServiceProvider>;
    oidcConnectionType: OIDCConnectionAuthType;
    oidcLoginUrl?: string;
    oidcUserCode?: string;
}

export interface ConnectionStateDisconnected extends ConnectionState {
    tag: "disconnected";
}

export interface ConnectionStateErrored extends ConnectionState {
    tag: "errored";
    errorReason: string;
}

export type AnyConnectionState =
    | ConnectionStateConnected
    | ConnectionStateConnecting
    | ConnectionStateDisconnected
    | ConnectionStateErrored;

export interface ConnectionManagerEvents {
    "connection-request": [AnyConnectionState];
    "connection-success": [ConnectionStateConnected];
    "connection-time-out": [ConnectionStateErrored];
    "connection-close": [ConnectionStateDisconnected];
    "connection-error": [ConnectionStateErrored];
    close: [AnyConnectionState];
}

export abstract class ConnectionManager {
    public clientName: string;
    protected readonly _events: EventEmitter<ConnectionManagerEvents>;
    readonly events: Pick<EventEmitter<ConnectionManagerEvents>, "on" | "off" | "once">;
    private state: AnyConnectionState;

    constructor() {
        this.clientName = "unknown";
        this.events = this._events = new EventEmitter<ConnectionManagerEvents>();
        this.state = { tag: "disconnected" };
    }

    get currentConnectionState(): AnyConnectionState {
        return this.state;
    }

    protected changeState<Event extends keyof ConnectionManagerEvents, State extends ConnectionManagerEvents[Event][0]>(
        event: Event,
        newState: State
    ): State {
        this.state = newState;
        // TypeScript doesn't seem to be happy with the spread operator and generics
        // eslint-disable-next-line
        this._events.emit(event, ...([newState] as any));
        return newState;
    }

    setClientName(clientName: string): void {
        this.clientName = clientName;
    }

    abstract connect(settings: ConnectionSettings): Promise<AnyConnectionState>;
    abstract disconnect(): Promise<ConnectionStateDisconnected | ConnectionStateErrored>;
    abstract close(): Promise<void>;
}

/**
 * Configuration options for creating an {@link MCPConnectionManager}.
 */
export type ConnectionManagerOptions = {
    /** Logger used for OIDC and disconnect diagnostics. */
    logger: LoggerBase;
    /** Provider of the stable device identifier embedded in the connection's `appName`. */
    deviceId: DeviceId;
    /** Product name and version merged into MongoDB driver `appName` when not already set on the URI. */
    serverMetadata: ServerMetadata;
    /** Transport / browser hints for OIDC auth inference. */
    connectionInfo: ConnectionInfo;
    /** Optional event emitter shared with the OIDC plugin to receive `mongodb-oidc-plugin:auth-*` notifications. */
    bus?: EventEmitter;
};

/**
 * Default {@link ConnectionManager} implementation used by the MongoDB MCP
 * server.
 *
 * Establishes and tears down MongoDB connections via mongosh's
 * NodeDriverServiceProvider, applying MCP-specific defaults such as the
 * `appName` (composed from package info, device id and client name) and driver
 * options (read/write concerns, proxy and OIDC settings).
 *
 * Tracks connection lifecycle as an {@link AnyConnectionState} and emits
 * `connection-request`, `connection-success`, `connection-error`,
 * `connection-close` and `close` events on {@link ConnectionManager.events}.
 * For OIDC connection strings it stays in the `connecting` state until the OIDC
 * plugin reports auth success or failure (via the shared event bus), surfacing
 * device-flow verification URL and user code when applicable.
 */
export class MCPConnectionManager extends ConnectionManager {
    private deviceId: DeviceId;
    private bus: EventEmitter;

    private readonly serverMetadata: ServerMetadata;
    private readonly connectionInfo: ConnectionInfo;
    private logger: LoggerBase;

    /**
     * @param options.logger - Logger used for OIDC and disconnect diagnostics.
     * @param options.deviceId - Provider of the stable device identifier embedded in
     * the connection's `appName`.
     * @param options.serverMetadata - Product name and version for MongoDB driver `appName`.
     * @param options.connectionInfo - Transport / browser hints for OIDC auth inference.
     * @param options.bus - Optional event emitter shared with the OIDC plugin.
     */
    constructor({ logger, deviceId, bus, serverMetadata, connectionInfo }: ConnectionManagerOptions) {
        super();
        this.serverMetadata = serverMetadata;
        this.connectionInfo = connectionInfo;
        this.logger = logger;
        this.bus = bus ?? new EventEmitter();
        this.bus.on("mongodb-oidc-plugin:auth-failed", this.onOidcAuthFailed.bind(this));
        // eslint-disable-next-line @typescript-eslint/no-misused-promises
        this.bus.on("mongodb-oidc-plugin:auth-succeeded", this.onOidcAuthSucceeded.bind(this));
        this.deviceId = deviceId;
    }

    /**
     * Opens a new MongoDB connection from the supplied {@link ConnectionSettings},
     * disconnecting any prior connection first.
     *
     * Resolves to a `connected` state for non-OIDC auth and to a `connecting`
     * state for OIDC flows (which transition to `connected` once the OIDC
     * plugin reports success on the shared event bus). On failure, transitions
     * to an `errored` state and throws a {@link MongoDBError} with either
     * {@link ErrorCodes.MisconfiguredConnectionString} or
     * {@link ErrorCodes.NotConnectedToMongoDB}.
     */
    override async connect(settings: ConnectionSettings): Promise<AnyConnectionState> {
        this._events.emit("connection-request", this.currentConnectionState);

        if (this.currentConnectionState.tag === "connected" || this.currentConnectionState.tag === "connecting") {
            await this.disconnect();
        }

        let serviceProvider: Promise<NodeDriverServiceProvider>;
        let connectionStringInfo: ConnectionStringInfo = { authType: "scram", hostType: "unknown" };

        try {
            settings = { ...settings };
            const appNameComponents: AppNameComponents = {
                appName: `${this.serverMetadata.mcpServerName} ${this.serverMetadata.version}`,
                deviceId: this.deviceId.get(),
                clientName: this.clientName,
            };

            settings.connectionString = await setAppNameParamIfMissing({
                connectionString: settings.connectionString,
                components: appNameComponents,
            });

            const mongoshConnectionInfo: MongoshConnectionInfo = {
                connectionString: settings.connectionString,
                driverOptions: settings.driverOptions,
            };

            if (mongoshConnectionInfo.driverOptions.oidc) {
                mongoshConnectionInfo.driverOptions.oidc.allowedFlows ??= ["auth-code"];
                mongoshConnectionInfo.driverOptions.oidc.notifyDeviceFlow ??= this.onOidcNotifyDeviceFlow.bind(this);
            }

            mongoshConnectionInfo.driverOptions.proxy ??= { useEnvironmentVariableProxies: true };
            mongoshConnectionInfo.driverOptions.applyProxyToOIDC ??= true;

            connectionStringInfo = getConnectionStringInfo(
                mongoshConnectionInfo.connectionString,
                this.connectionInfo,
                settings.atlas
            );

            serviceProvider = NodeDriverServiceProvider.connect(
                mongoshConnectionInfo.connectionString,
                {
                    productDocsLink: "https://github.com/mongodb-js/mongodb-mcp-server/",
                    productName: "MongoDB MCP",
                    ...mongoshConnectionInfo.driverOptions,
                },
                undefined,
                this.bus
            );
        } catch (error: unknown) {
            const errorReason = error instanceof Error ? error.message : `${error as string}`;
            this.changeState("connection-error", {
                tag: "errored",
                errorReason,
                connectionStringInfo,
                connectedAtlasCluster: settings.atlas,
            });
            throw new MongoDBError(ErrorCodes.MisconfiguredConnectionString, errorReason);
        }

        try {
            if (connectionStringInfo.authType.startsWith("oidc")) {
                return this.changeState("connection-request", {
                    tag: "connecting",
                    serviceProvider,
                    connectedAtlasCluster: settings.atlas,
                    connectionStringInfo,
                    oidcConnectionType: connectionStringInfo.authType as OIDCConnectionAuthType,
                });
            }

            return this.changeState(
                "connection-success",
                new ConnectionStateConnected({
                    serviceProvider: await serviceProvider,
                    connectionStringInfo,
                    connectedAtlasCluster: settings.atlas,
                })
            );
        } catch (error: unknown) {
            const errorReason = error instanceof Error ? error.message : `${error as string}`;
            this.changeState("connection-error", {
                tag: "errored",
                errorReason,
                connectionStringInfo,
                connectedAtlasCluster: settings.atlas,
            });
            throw new MongoDBError(ErrorCodes.NotConnectedToMongoDB, errorReason);
        }
    }

    /**
     * Closes the underlying NodeDriverServiceProvider (awaiting it first when
     * the manager is still in the `connecting` state) and emits
     * `connection-close`. No-op when already `disconnected` or `errored`, in
     * which case the current state is returned as-is.
     */
    override async disconnect(): Promise<ConnectionStateDisconnected | ConnectionStateErrored> {
        if (this.currentConnectionState.tag === "disconnected" || this.currentConnectionState.tag === "errored") {
            return this.currentConnectionState;
        }

        if (this.currentConnectionState.tag === "connected" || this.currentConnectionState.tag === "connecting") {
            try {
                if (this.currentConnectionState.tag === "connected") {
                    await this.currentConnectionState.serviceProvider?.close();
                }
                if (this.currentConnectionState.tag === "connecting") {
                    const serviceProvider = await this.currentConnectionState.serviceProvider;
                    await serviceProvider.close();
                }
            } finally {
                this.changeState("connection-close", {
                    tag: "disconnected",
                });
            }
        }

        return { tag: "disconnected" };
    }

    /**
     * Permanently shuts the manager down: best-effort disconnect (errors are
     * logged, not thrown) followed by emission of the `close` event with the
     * final connection state.
     */
    override async close(): Promise<void> {
        try {
            await this.disconnect();
        } catch (err: unknown) {
            const error = err instanceof Error ? err : new Error(String(err));
            this.logger.error({
                id: LogId.mongodbDisconnectFailure,
                context: "ConnectionManager",
                message: `Error when closing ConnectionManager: ${error.message}`,
            });
        } finally {
            this._events.emit("close", this.currentConnectionState);
        }
    }

    private onOidcAuthFailed(error: unknown): void {
        if (
            this.currentConnectionState.tag === "connecting" &&
            this.currentConnectionState.connectionStringInfo?.authType?.startsWith("oidc")
        ) {
            void this.disconnectOnOidcError(error);
        }
    }

    private async onOidcAuthSucceeded(): Promise<void> {
        if (
            this.currentConnectionState.tag === "connecting" &&
            this.currentConnectionState.connectionStringInfo?.authType?.startsWith("oidc")
        ) {
            this.changeState(
                "connection-success",
                new ConnectionStateConnected({
                    serviceProvider: await this.currentConnectionState.serviceProvider,
                    connectionStringInfo: this.currentConnectionState.connectionStringInfo,
                    connectedAtlasCluster: this.currentConnectionState.connectedAtlasCluster,
                })
            );
        }

        this.logger.info({
            id: LogId.oidcFlow,
            context: "mongodb-oidc-plugin:auth-succeeded",
            message: "Authenticated successfully.",
        });
    }

    private onOidcNotifyDeviceFlow(flowInfo: { verificationUrl: string; userCode: string }): void {
        if (
            this.currentConnectionState.tag === "connecting" &&
            this.currentConnectionState.connectionStringInfo?.authType?.startsWith("oidc")
        ) {
            this.changeState("connection-request", {
                ...this.currentConnectionState,
                tag: "connecting",
                connectionStringInfo: {
                    ...this.currentConnectionState.connectionStringInfo,
                    authType: "oidc-device-flow",
                },
                oidcLoginUrl: flowInfo.verificationUrl,
                oidcUserCode: flowInfo.userCode,
            });
        }

        this.logger.info({
            id: LogId.oidcFlow,
            context: "mongodb-oidc-plugin:notify-device-flow",
            message: "OIDC Flow changed automatically to device flow.",
        });
    }

    private async disconnectOnOidcError(error: unknown): Promise<void> {
        try {
            await this.disconnect();
        } catch (error: unknown) {
            this.logger.warning({
                id: LogId.oidcFlow,
                context: "disconnectOnOidcError",
                message: String(error),
            });
        } finally {
            this.changeState("connection-error", { tag: "errored", errorReason: String(error) });
        }
    }
}

/**
 * Consumers of MCP server library have option to bring their own connection
 * management if they need to. To support that, we enable injecting connection
 * manager implementation through a factory function.
 */
export type ConnectionManagerFactoryOptions = {
    logger: LoggerBase;
    deviceId: DeviceId;
    serverMetadata: ServerMetadata;
    connectionInfo: ConnectionInfo;
};

export type ConnectionManagerFactoryFn = (params: ConnectionManagerFactoryOptions) => Promise<ConnectionManager>;
