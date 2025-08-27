import { EventEmitter } from "events";
import type { NodeDriverServiceProvider } from "@mongosh/service-provider-node-driver";

export interface AtlasClusterConnectionInfo {
    username: string;
    projectId: string;
    clusterName: string;
    expiryDate: Date;
}

type ConnectionTag = "connected" | "connecting" | "disconnected" | "errored";
export type OIDCConnectionAuthType = "oidc-auth-flow" | "oidc-device-flow";
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

export interface MCPConnectParams {
    connectionString: string;
    atlas?: AtlasClusterConnectionInfo;
}

export abstract class ConnectionManager<ConnectParams extends MCPConnectParams = MCPConnectParams> {
    protected clientName: string = "unknown";

    protected readonly _events = new EventEmitter<ConnectionManagerEvents>();
    readonly events: Pick<EventEmitter<ConnectionManagerEvents>, "on" | "off" | "once"> = this._events;

    protected state: AnyConnectionState = { tag: "disconnected" };

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
        this._events.emit(event, ...([newState] as any));
        return newState;
    }

    setClientName(clientName: string): void {
        this.clientName = clientName;
    }

    abstract connect(connectParams: ConnectParams): Promise<AnyConnectionState>;

    abstract disconnect(): Promise<ConnectionStateDisconnected | ConnectionStateErrored>;
}
