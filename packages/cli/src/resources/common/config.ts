import { ReactiveResource, Keychain, redactValues } from "@mongodb-js/mcp-core";
import type { ResourceConstructorParams } from "@mongodb-js/mcp-types";
import type { UserConfig } from "@mongodb-js/mcp-cli";
import { generateConnectionInfoFromCliArgs } from "@mongosh/arg-parser";
import type { CliSession } from "@mongodb-js/mcp-cli";

/**
 * Removes secret material from the driver options before exposing them via the config resource.
 * The `autoEncryption` block can carry a variety of sensitive values, so the whole block is
 * replaced with a non-sensitive summary rather than emitted verbatim.
 */
function redactDriverOptions(driverOptions: Record<string, unknown>): Record<string, unknown> {
    const { autoEncryption, ...rest } = driverOptions;
    if (autoEncryption === undefined) {
        return rest;
    }
    return { ...rest, autoEncryption: "set; client-side field level encryption is configured" };
}

export class ConfigResource extends ReactiveResource<
    UserConfig,
    readonly [],
    CliSession
> {
    constructor({ session, ...rest }: ResourceConstructorParams<CliSession>) {
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
        const connectionInfo = generateConnectionInfoFromCliArgs(this.current);
        const result = {
            telemetry: this.current.telemetry,
            logPath: this.current.logPath,
            connectionString: connectionInfo.connectionString
                ? "set; access to MongoDB tools are currently available to use"
                : "not set; before using any MongoDB tool, you need to configure a connection string, alternatively you can setup MongoDB Atlas access, more info at 'https://github.com/mongodb-js/mongodb-mcp-server'.",
            connectOptions: redactDriverOptions(connectionInfo.driverOptions),
            atlas:
                this.current.apiClientId && this.current.apiClientSecret
                    ? "set; MongoDB Atlas tools are currently available to use"
                    : "not set; MongoDB Atlas tools are currently unavailable, to have access to MongoDB Atlas tools like creating clusters or connecting to clusters make sure to setup credentials, more info at 'https://github.com/mongodb-js/mongodb-mcp-server'.",
        };

        // Backstop: redact any remaining registered secrets (keychain) before egress, matching
        // the redaction applied on every logging path. Redact per-value so JSON stays valid.
        const secrets = [...this.session.keychain.allSecrets, ...Keychain.root.allSecrets];
        return JSON.stringify(redactValues(result, secrets));
    }
}
