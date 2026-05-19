import { ReactiveResource, type ResourceConstructorParams } from "@mongodb-js/mcp-core";
import type { UserConfig } from "@mongodb-js/mcp-cli";
import type { IResourceSession } from "@mongodb-js/mcp-types";
import { generateConnectionInfoFromCliArgs } from "@mongosh/arg-parser";

export class ConfigResource extends ReactiveResource<
    UserConfig,
    readonly [],
    IResourceSession<UserConfig>
> {
    constructor(params: ResourceConstructorParams<IResourceSession<UserConfig>>) {
        super({
            resourceConfiguration: {
                name: "config",
                uri: "config://config",
                config: {
                    description:
                        "Server configuration, supplied by the user either as environment variables or as startup arguments",
                },
            },
            options: {
                initial: { ...params.session.userConfig },
                events: [],
            },
            ...params,
        });
    }

    reduce(): UserConfig {
        return this.current;
    }

    toOutput(): string {
        const connectionInfo = generateConnectionInfoFromCliArgs(this.session.userConfig);
        const result = {
            telemetry: this.session.userConfig.telemetry,
            logPath: this.session.userConfig.logPath,
            connectionString: connectionInfo.connectionString
                ? "set; access to MongoDB tools are currently available to use"
                : "not set; before using any MongoDB tool, you need to configure a connection string, alternatively you can setup MongoDB Atlas access, more info at 'https://github.com/mongodb-js/mongodb-mcp-server'.",
            connectOptions: connectionInfo.driverOptions,
            atlas:
                this.session.userConfig.apiClientId && this.session.userConfig.apiClientSecret
                    ? "set; MongoDB Atlas tools are currently available to use"
                    : "not set; MongoDB Atlas tools are currently unavailable, to have access to MongoDB Atlas tools like creating clusters or connecting to clusters make sure to setup credentials, more info at 'https://github.com/mongodb-js/mongodb-mcp-server'.",
        };

        return JSON.stringify(result);
    }
}
