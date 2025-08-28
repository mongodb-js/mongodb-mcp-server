import { ReactiveResource } from "../resource.js";
import type { Telemetry } from "../../telemetry/telemetry.js";
import type { Session, UserConfig } from "../../lib.js";
import type { AtlasClusterConnectionInfo, ConnectionStateErrored } from "../../common/connectionManager.js";

type ConnectionStateDebuggingInformation = {
    readonly tag: "connected" | "connecting" | "disconnected" | "errored";
    readonly connectionStringAuthType?: "scram" | "ldap" | "kerberos" | "oidc-auth-flow" | "oidc-device-flow" | "x.509";
    readonly errorReason?: string;
    readonly connectedAtlasCluster?: AtlasClusterConnectionInfo;
};

export class DebugResource extends ReactiveResource<
    ConnectionStateDebuggingInformation,
    readonly ["connect", "disconnect", "close", "connection-error"]
> {
    constructor(session: Session, config: UserConfig, telemetry: Telemetry) {
        super({
            resourceConfiguration: {
                name: "debug-mongodb",
                uri: "debug://mongodb",
                config: {
                    description:
                        "Debugging information for MongoDB connectivity issues. Tracks the last connectivity attempt and error information.",
                },
            },
            options: {
                initial: { tag: "disconnected" },
                events: ["connect", "disconnect", "close", "connection-error"],
            },
            session,
            config,
            telemetry,
        });
    }
    reduce(
        eventName: "connect" | "disconnect" | "close" | "connection-error",
        event: ConnectionStateErrored | undefined
    ): ConnectionStateDebuggingInformation {
        switch (eventName) {
            case "connect":
                return { tag: "connected" };
            case "connection-error": {
                return {
                    tag: "errored",
                    connectionStringAuthType: event?.connectionStringAuthType,
                    connectedAtlasCluster: event?.connectedAtlasCluster,
                    errorReason:
                        event?.errorReason ??
                        "Could not find a reason. This might be a bug in the MCP Server. Please open an issue in https://github.com/mongodb-js/mongodb-mcp-server.",
                };
            }
            case "disconnect":
            case "close":
                return { tag: "disconnected" };
        }
    }

    toOutput(): string {
        let result = "";

        switch (this.current.tag) {
            case "connected":
                result += "The user is connected to the MongoDB cluster.";
                break;
            case "errored":
                result += `The user is not connected to a MongoDB cluster because of an error.\n`;
                if (this.current.connectedAtlasCluster) {
                    result += `Attempted connecting to Atlas Cluster "${this.current.connectedAtlasCluster.clusterName}" in project with id "${this.current.connectedAtlasCluster.projectId}".\n`;
                }

                if (this.current.connectionStringAuthType !== undefined) {
                    result += `The inferred authentication mechanism is "${this.current.connectionStringAuthType}".\n`;
                }
                result += `<error>${this.current.errorReason}</error>`;
                break;
            case "connecting":
            case "disconnected":
                result += "The user is not connected to a MongoDB cluster.";
                break;
        }

        return result;
    }
}
