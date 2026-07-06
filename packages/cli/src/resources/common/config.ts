import { ReactiveResource } from "@mongodb-js/mcp-core";
import type { ResourceConstructorParams } from "@mongodb-js/mcp-types";
import type { UserConfig } from "@mongodb-js/mcp-cli";
import { generateConnectionInfoFromCliArgs } from "@mongosh/arg-parser";
import type { CliSession } from "@mongodb-js/mcp-cli";

export class ConfigResource extends ReactiveResource<
    UserConfig,
    readonly [],
    CliSession
> {
    constructor({session, ...rest}: ResourceConstructorParams<CliSession>) {
        super({
            options: {
                resource: {
                    name: "config",
                    uri: "config://config",
                    config: {
                        description:
                            "Server configuration, supplied by the user either as environment variables or as startup arguments",
                    },
                },
                initial: { ...session.config },
                events: [],
            },
            session,
            ...rest,
        });
    }

    reduce(): UserConfig {
        return this.current;
    }

    toOutput(): string {
        const { config } = this.session;
        const connectionInfo = generateConnectionInfoFromCliArgs(config);
        const result = {
            telemetry: config.telemetry,
            logPath: config.logPath,
            connectionString: connectionInfo.connectionString
                ? "set; access to MongoDB tools are currently available to use"
                : "not set; before using any MongoDB tool, you need to configure a connection string, alternatively you can setup MongoDB Atlas access, more info at 'https://github.com/mongodb-js/mongodb-mcp-server'.",
            connectOptions: connectionInfo.driverOptions,
            atlas:
                config.apiClientId && config.apiClientSecret
                    ? "set; MongoDB Atlas tools are currently available to use"
                    : "not set; MongoDB Atlas tools are currently unavailable, to have access to MongoDB Atlas tools like creating clusters or connecting to clusters make sure to setup credentials, more info at 'https://github.com/mongodb-js/mongodb-mcp-server'.",
        };

        return JSON.stringify(result);
    }
}
