import { ReactiveResource, Keychain, redactValues, type AnyToolBase } from "@mongodb-js/mcp-core";
import type { ResourceConstructorParams, IResourceServer } from "@mongodb-js/mcp-types";
import type { UserConfig, McpSession } from "@mongodb-js/mcp-cli";
import { generateConnectionInfoFromCliArgs } from "@mongosh/arg-parser";
import { connectCapableTools } from "@mongodb-js/mcp-tools-mongodb";

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

/**
 * Host server surface the resource can read tool state from. The typed
 * `IResourceServer` contract (see @mongodb-js/mcp-types) only exposes mcpServer
 * and change notifications; at runtime the resource is registered by
 * `CliServer` (see `registerResources`), which also carries the registered
 * tools. The optional-chain cast below keeps access safe when the resource is
 * registered by a different host.
 */
type ResourceServerWithTools = IResourceServer & { readonly tools?: AnyToolBase[] };

export class ConfigResource extends ReactiveResource<UserConfig, readonly [], McpSession> {
    constructor({ session, ...rest }: ResourceConstructorParams<McpSession>) {
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
                ? 'set; a connection with the connectionId "preconfigured" is available — pass it as the connectionId argument to the MongoDB tools'
                : `not set; before using any MongoDB tool, ${this.connectToolsGuidance()}, alternatively you can setup MongoDB Atlas access, more info at 'https://github.com/mongodb-js/mongodb-mcp-server'.`,
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

    private connectToolsGuidance(): string {
        const connectToolNames = connectCapableTools(
            (this.server as ResourceServerWithTools | undefined)?.tools ?? []
        )
            .map((tool) => `"${tool.name}"`)
            .join(", ");
        return connectToolNames
            ? `establish a connection using one of the following tools and pass the returned connectionId to the MongoDB tools: ${connectToolNames}`
            : "update the MCP server configuration to include a connection string";
    }
}
