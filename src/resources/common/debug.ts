import { ReactiveResource } from "../resource.js";
import { config } from "../../common/config.js";
import type { UserConfig } from "../../common/config.js";

type ConnectionStateDebuggingInformation = {
    readonly tag: "connected" | "connecting" | "disconnected" | "errored";
    readonly connectionStringAuthType?: "scram" | "ldap" | "kerberos" | "oidc-auth-flow" | "oidc-device-flow" | "x.509";
    readonly oidcLoginUrl?: string;
    readonly oidcUserCode?: string;
    readonly errorReason?: string;
};

export class DebugResource extends ReactiveResource(
    {
        name: "debug",
        uri: "config://debug",
        config: {
            description: "Debugging information for connectivity issues.",
        },
    },
    {
        initial: { tag: "disconnected" },
        events: ["connected", "disconnect", "close"],
    }
) {
    reduce(
        previous: ConnectionStateDebuggingInformation,
        eventName: "connected" | "disconnect" | "close",
        event: undefined
    ): ConnectionStateDebuggingInformation {
        void event;

        switch (eventName) {
            case "connected":
                return { tag: "connected" };
            case "disconnect":
                return { tag: "disconnected" };
            case "close":
                return { tag: "disconnected" };
        }
    }

    toOutput(state: ConnectionStateDebuggingInformation): string {
        const result = {
            connectionStatus: state.tag,
        };

        return JSON.stringify(result);
    }
}
