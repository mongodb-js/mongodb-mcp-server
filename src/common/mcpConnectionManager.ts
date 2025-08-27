import type { UserConfig, DriverOptions } from "./config.js";
import { NodeDriverServiceProvider } from "@mongosh/service-provider-node-driver";
import EventEmitter from "events";
import { setAppNameParamIfMissing } from "../helpers/connectionOptions.js";
import { packageInfo } from "./packageInfo.js";
import ConnectionString from "mongodb-connection-string-url";
import type { MongoClientOptions } from "mongodb";
import { ErrorCodes, MongoDBError } from "./errors.js";
import type { DeviceId } from "../helpers/deviceId.js";
import type { AppNameComponents } from "../helpers/connectionOptions.js";
import type { CompositeLogger } from "./logger.js";
import { LogId } from "./logger.js";
import type { ConnectionInfo } from "@mongosh/arg-parser";
import { generateConnectionInfoFromCliArgs } from "@mongosh/arg-parser";
import {
    ConnectionManager,
    type AnyConnectionState,
    type ConnectionStringAuthType,
    type OIDCConnectionAuthType,
    type ConnectionStateDisconnected,
    type ConnectionStateErrored,
    type MCPConnectParams,
} from "./connectionManager.js";

export class MCPConnectionManager extends ConnectionManager<MCPConnectParams> {
    private deviceId: DeviceId;
    private bus: EventEmitter;

    constructor(
        private userConfig: UserConfig,
        private driverOptions: DriverOptions,
        private logger: CompositeLogger,
        deviceId: DeviceId,
        bus?: EventEmitter
    ) {
        super();
        this.bus = bus ?? new EventEmitter();
        this.bus.on("mongodb-oidc-plugin:auth-failed", this.onOidcAuthFailed.bind(this));
        this.bus.on("mongodb-oidc-plugin:auth-succeeded", this.onOidcAuthSucceeded.bind(this));
        this.deviceId = deviceId;
        this.clientName = "unknown";
    }

    async connect(connectParams: MCPConnectParams): Promise<AnyConnectionState> {
        this._events.emit("connection-requested", this.state);

        if (this.state.tag === "connected" || this.state.tag === "connecting") {
            await this.disconnect();
        }

        let serviceProvider: NodeDriverServiceProvider;
        let connectionInfo: ConnectionInfo;

        try {
            connectParams = { ...connectParams };
            const appNameComponents: AppNameComponents = {
                appName: `${packageInfo.mcpServerName} ${packageInfo.version}`,
                deviceId: this.deviceId.get(),
                clientName: this.clientName,
            };

            connectParams.connectionString = await setAppNameParamIfMissing({
                connectionString: connectParams.connectionString,
                components: appNameComponents,
            });

            connectionInfo = generateConnectionInfoFromCliArgs({
                ...this.userConfig,
                ...this.driverOptions,
                connectionSpecifier: connectParams.connectionString,
            });

            if (connectionInfo.driverOptions.oidc) {
                connectionInfo.driverOptions.oidc.allowedFlows ??= ["auth-code"];
                connectionInfo.driverOptions.oidc.notifyDeviceFlow ??= this.onOidcNotifyDeviceFlow.bind(this);
            }

            connectionInfo.driverOptions.proxy ??= { useEnvironmentVariableProxies: true };
            connectionInfo.driverOptions.applyProxyToOIDC ??= true;

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
            this.changeState("connection-errored", {
                tag: "errored",
                errorReason,
                connectedAtlasCluster: connectParams.atlas,
            });
            throw new MongoDBError(ErrorCodes.MisconfiguredConnectionString, errorReason);
        }

        try {
            const connectionType = MCPConnectionManager.inferConnectionTypeFromSettings(
                this.userConfig,
                connectionInfo
            );
            if (connectionType.startsWith("oidc")) {
                void this.pingAndForget(serviceProvider);

                return this.changeState("connection-requested", {
                    tag: "connecting",
                    connectedAtlasCluster: connectParams.atlas,
                    serviceProvider,
                    connectionStringAuthType: connectionType,
                    oidcConnectionType: connectionType as OIDCConnectionAuthType,
                });
            }

            await serviceProvider?.runCommand?.("admin", { hello: 1 });

            return this.changeState("connection-succeeded", {
                tag: "connected",
                connectedAtlasCluster: connectParams.atlas,
                serviceProvider,
                connectionStringAuthType: connectionType,
            });
        } catch (error: unknown) {
            const errorReason = error instanceof Error ? error.message : `${error as string}`;
            this.changeState("connection-errored", {
                tag: "errored",
                errorReason,
                connectedAtlasCluster: connectParams.atlas,
            });
            throw new MongoDBError(ErrorCodes.NotConnectedToMongoDB, errorReason);
        }
    }

    async disconnect(): Promise<ConnectionStateDisconnected | ConnectionStateErrored> {
        if (this.state.tag === "disconnected" || this.state.tag === "errored") {
            return this.state;
        }

        if (this.state.tag === "connected" || this.state.tag === "connecting") {
            try {
                await this.state.serviceProvider?.close(true);
            } finally {
                this.changeState("connection-closed", {
                    tag: "disconnected",
                });
            }
        }

        return { tag: "disconnected" };
    }

    private onOidcAuthFailed(error: unknown): void {
        if (this.state.tag === "connecting" && this.state.connectionStringAuthType?.startsWith("oidc")) {
            void this.disconnectOnOidcError(error);
        }
    }

    private onOidcAuthSucceeded(): void {
        if (this.state.tag === "connecting" && this.state.connectionStringAuthType?.startsWith("oidc")) {
            this.changeState("connection-succeeded", { ...this.state, tag: "connected" });
        }

        this.logger.info({
            id: LogId.oidcFlow,
            context: "mongodb-oidc-plugin:auth-succeeded",
            message: "Authenticated successfully.",
        });
    }

    private onOidcNotifyDeviceFlow(flowInfo: { verificationUrl: string; userCode: string }): void {
        if (this.state.tag === "connecting" && this.state.connectionStringAuthType?.startsWith("oidc")) {
            this.changeState("connection-requested", {
                ...this.state,
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
            this.changeState("connection-errored", { tag: "errored", errorReason: String(error) });
        }
    }
}
