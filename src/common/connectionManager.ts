import { driverOptions } from "./config.js";
import { NodeDriverServiceProvider } from "@mongosh/service-provider-node-driver";
import EventEmitter from "events";
import { setAppNameParamIfMissing } from "../helpers/connectionOptions.js";
import { packageInfo } from "./packageInfo.js";
import ConnectionString from "mongodb-connection-string-url";
import { MongoClientOptions } from "mongodb";
import { ErrorCodes, MongoDBError } from "./errors.js";

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
    "connection-requested": [AnyConnectionState];
    "connection-succeeded": [ConnectionStateConnected];
    "connection-timed-out": [ConnectionStateErrored];
    "connection-closed": [ConnectionStateDisconnected];
    "connection-errored": [ConnectionStateErrored];
}

export class ConnectionManager extends EventEmitter<ConnectionManagerEvents> {
    private state: AnyConnectionState;

    constructor() {
        super();

        this.state = { tag: "disconnected" };
    }

    async connect(settings: ConnectionSettings): Promise<AnyConnectionState> {
        this.emit("connection-requested", this.state);

        if (this.state.tag === "connected" || this.state.tag === "connecting") {
            await this.disconnect();
        }

        let serviceProvider: NodeDriverServiceProvider;
        try {
            settings = { ...settings };
            settings.connectionString = setAppNameParamIfMissing({
                connectionString: settings.connectionString,
                defaultAppName: `${packageInfo.mcpServerName} ${packageInfo.version}`,
            });

            serviceProvider = await NodeDriverServiceProvider.connect(settings.connectionString, {
                productDocsLink: "https://github.com/mongodb-js/mongodb-mcp-server/",
                productName: "MongoDB MCP",
                ...driverOptions,
            });
        } catch (error: unknown) {
            const errorReason = error instanceof Error ? error.message : `${error as string}`;
            this.changeState("connection-errored", {
                tag: "errored",
                errorReason,
                connectedAtlasCluster: settings.atlas,
            });
            throw new MongoDBError(ErrorCodes.MisconfiguredConnectionString, errorReason);
        }

        try {
            await serviceProvider?.runCommand?.("admin", { hello: 1 });

            return this.changeState("connection-succeeded", {
                tag: "connected",
                connectedAtlasCluster: settings.atlas,
                serviceProvider,
                connectionStringAuthType: ConnectionManager.inferConnectionTypeFromSettings(settings),
            });
        } catch (error: unknown) {
            const errorReason = error instanceof Error ? error.message : `${error as string}`;
            this.changeState("connection-errored", {
                tag: "errored",
                errorReason,
                connectedAtlasCluster: settings.atlas,
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

    get currentConnectionState(): AnyConnectionState {
        return this.state;
    }

    changeState<Event extends keyof ConnectionManagerEvents, State extends ConnectionManagerEvents[Event][0]>(
        event: Event,
        newState: State
    ): State {
        this.state = newState;
        // TypeScript doesn't seem to be happy with the spread operator and generics
        // eslint-disable-next-line
        this.emit(event, ...([newState] as any));
        return newState;
    }

    static inferConnectionTypeFromSettings(settings: ConnectionSettings): ConnectionStringAuthType {
        const connString = new ConnectionString(settings.connectionString);
        const searchParams = connString.typedSearchParams<MongoClientOptions>();

        switch (searchParams.get("authMechanism")) {
            case "MONGODB-OIDC": {
                return "oidc-auth-flow"; // TODO: depending on if we don't have a --browser later it can be oidc-device-flow
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
}
