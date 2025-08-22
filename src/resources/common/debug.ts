import { ReactiveResource } from "../resource.js";
import type { Telemetry } from "../../telemetry/telemetry.js";
import type { Session, UserConfig } from "../../lib.js";

type ConnectionStateDebuggingInformation = {
    readonly tag: "connected" | "connecting" | "disconnected" | "errored";
    readonly connectionStringAuthType?: "scram" | "ldap" | "kerberos" | "oidc-auth-flow" | "oidc-device-flow" | "x.509";
    readonly oidcLoginUrl?: string;
    readonly oidcUserCode?: string;
    readonly errorReason?: string;
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
                        "Debugging information for MongoDB connectivity issues. Tracks the last connectivity error and attempt information.",
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
        event: string | undefined
    ): ConnectionStateDebuggingInformation {
        void event;

        switch (eventName) {
            case "connect":
                return { tag: "connected" };
            case "connection-error":
                return { tag: "errored", errorReason: event };
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
