import { ReactiveResource } from "../resource.js";
import { config } from "../../common/config.js";
import type { UserConfig } from "../../common/config.js";

export class ConfigResource extends ReactiveResource(
    {
        name: "config",
        uri: "config://config",
        config: {
            description:
                "Server configuration, supplied by the user either as environment variables or as startup arguments",
        },
    },
    {
        initial: { ...config },
        events: [],
    }
) {
    reduce(previous: UserConfig, eventName: undefined, event: undefined): UserConfig {
        void event;
        return previous;
    }

    toOutput(state: UserConfig): string {
        const result = {
            telemetry: state.telemetry,
            logPath: state.logPath,
            connectionString: state.connectionString
                ? "set; access to MongoDB tools are currently available to use"
                : "not set; before using any MongoDB tool, you need to configure a connection string, alternatively you can setup MongoDB Atlas access, more info at 'https://github.com/mongodb-js/mongodb-mcp-server'.",
            connectOptions: state.connectOptions,
            atlas:
                state.apiClientId && state.apiClientSecret
                    ? "set; MongoDB Atlas tools are currently available to use"
                    : "not set; MongoDB Atlas tools are currently unavailable, to have access to MongoDB Atlas tools like creating clusters or connecting to clusters make sure to setup credentials, more info at 'https://github.com/mongodb-js/mongodb-mcp-server'.",
        };

        return JSON.stringify(result);
    }
}
