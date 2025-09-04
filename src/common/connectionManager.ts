import { EventEmitter } from "events";
import type { MongoClientOptions } from "mongodb";
import ConnectionString from "mongodb-connection-string-url";
import { NodeDriverServiceProvider } from "@mongosh/service-provider-node-driver";
import { type ConnectionInfo, generateConnectionInfoFromCliArgs } from "@mongosh/arg-parser";
import type { DeviceId } from "../helpers/deviceId.js";
import { defaultDriverOptions, setupDriverConfig, type DriverOptions, type UserConfig } from "./config.js";
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

export interface ConnectionSettings {
    connectionString: string;
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

export interface ConnectionStateConnected extends ConnectionState {
    tag: "connected";
    serviceProvider: NodeDriverServiceProvider;
}

export interface ConnectionStateConnecting extends ConnectionState {
    tag: "connecting";
    serviceProvider: NodeDriverServiceProvider;
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
}

/**
 * For a few tests, we need the changeState method to force a connection state
 * which is we have this type to typecast the actual ConnectionManager with
 * public changeState (only to make TS happy).
 */
export type TestConnectionManager = ConnectionManager & {
    changeState<Event extends keyof ConnectionManagerEvents, State extends ConnectionManagerEvents[Event][0]>(
        event: Event,
        newState: State
    ): State;
};

export abstract class ConnectionManager {
    protected clientName: string;
    protected readonly _events;
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
}

export class MCPConnectionManager extends ConnectionManager {
    private deviceId: DeviceId;
    private bus: EventEmitter;

    constructor(
        private userConfig: UserConfig,
        private driverOptions: DriverOptions,
        private logger: LoggerBase,
        deviceId: DeviceId,
        bus?: EventEmitter
    ) {
        super();
        this.bus = bus ?? new EventEmitter();
        this.bus.on("mongodb-oidc-plugin:auth-failed", this.onOidcAuthFailed.bind(this));
        this.bus.on("mongodb-oidc-plugin:auth-succeeded", this.onOidcAuthSucceeded.bind(this));
        this.deviceId = deviceId;
    }

    async connect(settings: ConnectionSettings): Promise<AnyConnectionState> {
        this._events.emit("connection-request", this.currentConnectionState);

        if (this.currentConnectionState.tag === "connected" || this.currentConnectionState.tag === "connecting") {
            await this.disconnect();
        }

        let serviceProvider: NodeDriverServiceProvider;
        let connectionInfo: ConnectionInfo;
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

            connectionInfo = generateConnectionInfoFromCliArgs({
                ...this.userConfig,
                ...this.driverOptions,
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

            serviceProvider = await NodeDriverServiceProvider.connect(
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
                void this.pingAndForget(serviceProvider);

                return this.changeState("connection-request", {
                    tag: "connecting",
                    connectedAtlasCluster: settings.atlas,
                    serviceProvider,
                    connectionStringAuthType,
                    oidcConnectionType: connectionStringAuthType as OIDCConnectionAuthType,
                });
            }

            await serviceProvider?.runCommand?.("admin", { hello: 1 });

            return this.changeState("connection-success", {
                tag: "connected",
                connectedAtlasCluster: settings.atlas,
                serviceProvider,
                connectionStringAuthType,
            });
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

    async disconnect(): Promise<ConnectionStateDisconnected | ConnectionStateErrored> {
        if (this.currentConnectionState.tag === "disconnected" || this.currentConnectionState.tag === "errored") {
            return this.currentConnectionState;
        }

        if (this.currentConnectionState.tag === "connected" || this.currentConnectionState.tag === "connecting") {
            try {
                await this.currentConnectionState.serviceProvider?.close(true);
            } finally {
                this.changeState("connection-close", {
                    tag: "disconnected",
                });
            }
        }

        return { tag: "disconnected" };
    }

    private onOidcAuthFailed(error: unknown): void {
        if (
            this.currentConnectionState.tag === "connecting" &&
            this.currentConnectionState.connectionStringAuthType?.startsWith("oidc")
        ) {
            void this.disconnectOnOidcError(error);
        }
    }

    private onOidcAuthSucceeded(): void {
        if (
            this.currentConnectionState.tag === "connecting" &&
            this.currentConnectionState.connectionStringAuthType?.startsWith("oidc")
        ) {
            this.changeState("connection-success", { ...this.currentConnectionState, tag: "connected" });
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

    private async pingAndForget(serviceProvider: NodeDriverServiceProvider): Promise<void> {
        try {
            await serviceProvider?.runCommand?.("admin", { hello: 1 });
        } catch (error: unknown) {
            this.logger.warning({
                id: LogId.oidcFlow,
                context: "pingAndForget",
                message: String(error),
            });
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
    const driverOptions = setupDriverConfig({
        config: userConfig,
        defaults: defaultDriverOptions,
    });

    return Promise.resolve(new MCPConnectionManager(userConfig, driverOptions, logger, deviceId));
};
