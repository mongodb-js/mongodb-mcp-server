import { EventEmitter } from "events";
import type { MongoClientOptions, MongoServerError } from "mongodb";
import { ConnectionString } from "mongodb-connection-string-url";
import { NodeDriverServiceProvider } from "@mongosh/service-provider-node-driver";
import { generateConnectionInfoFromCliArgs, type ConnectionInfo } from "@mongosh/arg-parser";
import type { DeviceId } from "../helpers/deviceId.js";
import { type UserConfig } from "./config/userConfig.js";
import { MongoDBError, ErrorCodes } from "./errors.js";
import { type LoggerBase, LogId } from "./logger.js";
import { packageInfo } from "./packageInfo.js";
import { type AppNameComponents, setAppNameParamIfMissing } from "../helpers/connectionOptions.js";

export interface AtlasClusterConnectionInfo {
    username: string;
    projectId: string;
    clusterName: string;
    expiryDate: Date;
}

export interface ConnectionSettings extends Omit<ConnectionInfo, "driverOptions"> {
    driverOptions?: ConnectionInfo["driverOptions"];
    atlas?: AtlasClusterConnectionInfo;
}

type ConnectionTag = "connected" | "connecting" | "disconnected" | "errored";
type OIDCConnectionAuthType = "oidc-auth-flow" | "oidc-device-flow";
export type ConnectionStringAuthType = "scram" | "ldap" | "kerberos" | OIDCConnectionAuthType | "x.509";

export interface ConnectionState {
    tag: ConnectionTag;
    connectionStringAuthType?: ConnectionStringAuthType;
    connectedAtlasCluster?: AtlasClusterConnectionInfo;
}

const MCP_TEST_DATABASE = "#mongodb-mcp";
const MCP_TEST_VECTOR_SEARCH_INDEX_FIELD = "__mongodb-mcp-field";
const MCP_TEST_VECTOR_SEARCH_INDEX_NAME = "mongodb-mcp-vector-search-index";

export const defaultDriverOptions: ConnectionInfo["driverOptions"] = {
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

    constructor(
        public serviceProvider: NodeDriverServiceProvider,
        public connectionStringAuthType?: ConnectionStringAuthType,
        public connectedAtlasCluster?: AtlasClusterConnectionInfo
    ) {}

    private connectionMetadata?: { searchSupported: boolean; autoEmbeddingIndexSupported: boolean };

    private async populateConnectionMetadata(): Promise<void> {
        try {
            await this.serviceProvider.createCollection(MCP_TEST_DATABASE, "test");
            // If a cluster supports search indexes, the call below will succeed
            // with a cursor otherwise will throw an Error. The Search Index
            // Management Service might not be ready yet, but we assume that the
            // agent can retry in that situation.
            await this.serviceProvider.createSearchIndexes(MCP_TEST_DATABASE, "test", [
                {
                    name: MCP_TEST_VECTOR_SEARCH_INDEX_NAME,
                    type: "vectorSearch",
                    definition: {
                        fields: [
                            {
                                // TODO: Before public preview this needs to be
                                // changed to either "autoEmbedText" or "autoEmbed"
                                // depending on which syntax is finalized.
                                type: "text",
                                path: MCP_TEST_VECTOR_SEARCH_INDEX_FIELD,
                                model: "voyage-3-large",
                            },
                        ],
                    },
                },
            ]);
            this.connectionMetadata = {
                searchSupported: true,
                autoEmbeddingIndexSupported: true,
            };
        } catch (error) {
            if ((error as MongoServerError).codeName === "SearchNotEnabled") {
                this.connectionMetadata = {
                    searchSupported: false,
                    autoEmbeddingIndexSupported: false,
                };
            }
            // If the error if because we tried creating an index with autoEmbed
            // field definition then we can safely assume that search is
            // supported but auto-embeddings are not.
            else if ((error as Error).message.includes('"userCommand.indexes[0].fields[0].type" must be one of')) {
                this.connectionMetadata = {
                    searchSupported: true,
                    autoEmbeddingIndexSupported: false,
                };
            }
        } finally {
            await this.serviceProvider.dropDatabase(MCP_TEST_DATABASE);
        }
    }

    public async isSearchSupported(): Promise<boolean> {
        if (this.connectionMetadata === undefined) {
            await this.populateConnectionMetadata();
        }

        return this.connectionMetadata?.searchSupported ?? false;
    }

    public async isAutoEmbeddingIndexSupported(): Promise<boolean> {
        if (this.connectionMetadata === undefined) {
            await this.populateConnectionMetadata();
        }

        return this.connectionMetadata?.autoEmbeddingIndexSupported ?? false;
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

export class MCPConnectionManager extends ConnectionManager {
    private deviceId: DeviceId;
    private bus: EventEmitter;

    constructor(
        private userConfig: UserConfig,
        private logger: LoggerBase,
        deviceId: DeviceId,
        bus?: EventEmitter
    ) {
        super();
        this.bus = bus ?? new EventEmitter();
        this.bus.on("mongodb-oidc-plugin:auth-failed", this.onOidcAuthFailed.bind(this));
        // eslint-disable-next-line @typescript-eslint/no-misused-promises
        this.bus.on("mongodb-oidc-plugin:auth-succeeded", this.onOidcAuthSucceeded.bind(this));
        this.deviceId = deviceId;
    }

    override async connect(settings: ConnectionSettings): Promise<AnyConnectionState> {
        this._events.emit("connection-request", this.currentConnectionState);

        if (this.currentConnectionState.tag === "connected" || this.currentConnectionState.tag === "connecting") {
            await this.disconnect();
        }

        let serviceProvider: Promise<NodeDriverServiceProvider>;
        let connectionStringAuthType: ConnectionStringAuthType = "scram";

        try {
            settings = { ...settings };
            const appNameComponents: AppNameComponents = {
                appName: `${packageInfo.mcpServerName} ${packageInfo.version}`,
                deviceId: this.deviceId.get(),
                clientName: this.clientName,
            };

            settings.connectionString = await setAppNameParamIfMissing({
                connectionString: settings.connectionString,
                components: appNameComponents,
            });

            const connectionInfo: ConnectionInfo = settings.driverOptions
                ? {
                      connectionString: settings.connectionString,
                      driverOptions: settings.driverOptions,
                  }
                : generateConnectionInfoFromCliArgs({
                      ...defaultDriverOptions,
                      connectionSpecifier: settings.connectionString,
                  });

            if (connectionInfo.driverOptions.oidc) {
                connectionInfo.driverOptions.oidc.allowedFlows ??= ["auth-code"];
                connectionInfo.driverOptions.oidc.notifyDeviceFlow ??= this.onOidcNotifyDeviceFlow.bind(this);
            }

            connectionInfo.driverOptions.proxy ??= { useEnvironmentVariableProxies: true };
            connectionInfo.driverOptions.applyProxyToOIDC ??= true;

            connectionStringAuthType = MCPConnectionManager.inferConnectionTypeFromSettings(
                this.userConfig,
                connectionInfo
            );

            serviceProvider = NodeDriverServiceProvider.connect(
                connectionInfo.connectionString,
                {
                    productDocsLink: "https://github.com/mongodb-js/mongodb-mcp-server/",
                    productName: "MongoDB MCP",
                    ...connectionInfo.driverOptions,
                },
                undefined,
                this.bus
            );
        } catch (error: unknown) {
            const errorReason = error instanceof Error ? error.message : `${error as string}`;
            this.changeState("connection-error", {
                tag: "errored",
                errorReason,
                connectionStringAuthType,
                connectedAtlasCluster: settings.atlas,
            });
            throw new MongoDBError(ErrorCodes.MisconfiguredConnectionString, errorReason);
        }

        try {
            if (connectionStringAuthType.startsWith("oidc")) {
                return this.changeState("connection-request", {
                    tag: "connecting",
                    serviceProvider,
                    connectedAtlasCluster: settings.atlas,
                    connectionStringAuthType,
                    oidcConnectionType: connectionStringAuthType as OIDCConnectionAuthType,
                });
            }

            return this.changeState(
                "connection-success",
                new ConnectionStateConnected(await serviceProvider, connectionStringAuthType, settings.atlas)
            );
        } catch (error: unknown) {
            const errorReason = error instanceof Error ? error.message : `${error as string}`;
            this.changeState("connection-error", {
                tag: "errored",
                errorReason,
                connectionStringAuthType,
                connectedAtlasCluster: settings.atlas,
            });
            throw new MongoDBError(ErrorCodes.NotConnectedToMongoDB, errorReason);
        }
    }

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
            this.currentConnectionState.connectionStringAuthType?.startsWith("oidc")
        ) {
            void this.disconnectOnOidcError(error);
        }
    }

    private async onOidcAuthSucceeded(): Promise<void> {
        if (
            this.currentConnectionState.tag === "connecting" &&
            this.currentConnectionState.connectionStringAuthType?.startsWith("oidc")
        ) {
            this.changeState(
                "connection-success",
                new ConnectionStateConnected(
                    await this.currentConnectionState.serviceProvider,
                    this.currentConnectionState.connectionStringAuthType,
                    this.currentConnectionState.connectedAtlasCluster
                )
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
            this.currentConnectionState.connectionStringAuthType?.startsWith("oidc")
        ) {
            this.changeState("connection-request", {
                ...this.currentConnectionState,
                tag: "connecting",
                connectionStringAuthType: "oidc-device-flow",
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

    static inferConnectionTypeFromSettings(
        config: UserConfig,
        settings: { connectionString: string }
    ): ConnectionStringAuthType {
        const connString = new ConnectionString(settings.connectionString);
        const searchParams = connString.typedSearchParams<MongoClientOptions>();

        switch (searchParams.get("authMechanism")) {
            case "MONGODB-OIDC": {
                if (config.transport === "stdio" && config.browser) {
                    return "oidc-auth-flow";
                }

                if (config.transport === "http" && config.httpHost === "127.0.0.1" && config.browser) {
                    return "oidc-auth-flow";
                }

                return "oidc-device-flow";
            }
            case "MONGODB-X509":
                return "x.509";
            case "GSSAPI":
                return "kerberos";
            case "PLAIN":
                if (searchParams.get("authSource") === "$external") {
                    return "ldap";
                }
                return "scram";
            // default should catch also null, but eslint complains
            // about it.
            case null:
            default:
                return "scram";
        }
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
export type ConnectionManagerFactoryFn = (createParams: {
    logger: LoggerBase;
    deviceId: DeviceId;
    userConfig: UserConfig;
}) => Promise<ConnectionManager>;

export const createMCPConnectionManager: ConnectionManagerFactoryFn = ({ logger, deviceId, userConfig }) => {
    return Promise.resolve(new MCPConnectionManager(userConfig, logger, deviceId));
};
