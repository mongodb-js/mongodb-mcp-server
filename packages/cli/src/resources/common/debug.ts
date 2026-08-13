import { ReactiveResource, formatUntrustedData, type AnyToolBase, type LoggerBase } from "@mongodb-js/mcp-core";
import type { ResourceConstructorParams, IResourceServer } from "@mongodb-js/mcp-types";
import type { McpSession } from "@mongodb-js/mcp-cli";
import {
    connectCapableTools,
    summarizeConnection,
    type ConnectionRegistry,
} from "@mongodb-js/mcp-tools-mongodb";

/**
 * Session surface the debug resource reads from: everything on
 * `McpSession` (config, keychain, logger, ...) plus the app-level connection
 * registry that holds MongoDB connection state (see `@mongodb-js/mcp-cli`'s
 * stateless `Session`).
 */
export type DebugSession = McpSession & {
    readonly connectionRegistry: ConnectionRegistry;
    /** The registry probe APIs (`isSearchSupported`) take the concrete logger base. */
    logger: LoggerBase;
};

/**
 * Host server surface the resource can read tool state from. The typed
 * `IResourceServer` contract (see @mongodb-js/mcp-types) only exposes mcpServer
 * and change notifications; at runtime the resource is registered by
 * `CliServer` (see `registerResources`), which also carries the registered
 * tools. The optional-chain cast below keeps access safe when the resource is
 * registered by a different host.
 */
type ResourceServerWithTools = IResourceServer & { readonly tools?: AnyToolBase[] };

export class DebugResource extends ReactiveResource<undefined, readonly [], DebugSession> {
    constructor(params: ResourceConstructorParams<DebugSession>) {
        super({
            options: {
                resource: {
                    name: "debug-mongodb",
                    uri: "debug://mongodb",
                    config: {
                        description:
                            "Debugging information for MongoDB connectivity issues. Lists the active connections, their state, and the error from their last failed connection attempt.",
                    },
                },
                initial: undefined,
                events: [],
            },
            ...params,
        });
    }

    reduce(eventName: never, ...event: never[]): undefined {
        void eventName;
        void event;

        return this.current;
    }

    async toOutput(): Promise<string> {
        const entries = await this.session.connectionRegistry.find(() => true);
        if (entries.length === 0) {
            const connectToolNames = connectCapableTools(
                (this.server as ResourceServerWithTools | undefined)?.tools ?? []
            )
                .map((tool) => `"${tool.name}"`)
                .join(", ");
            if (!connectToolNames) {
                return "There are no MongoDB connections and no tools to establish one are enabled. Update the MCP server configuration to include a connection string.";
            }
            return `There are no MongoDB connections. Use one of the following tools to establish one and pass the returned connectionId to the MongoDB tools: ${connectToolNames}.`;
        }

        const lines: string[] = [];
        for (const entry of entries) {
            const summary = summarizeConnection(entry);
            let line = `- "${summary.connectionId}" (${summary.state}): ${summary.description}`;
            if (summary.state === "connected") {
                const searchIndexesSupported = await entry.isSearchSupported(this.session.logger);
                line += searchIndexesSupported
                    ? " Search indexes are supported."
                    : " Search indexes are not supported.";
            }
            lines.push(line);

            if (summary.lastError) {
                lines.push(
                    formatUntrustedData(
                        `  The last connection attempt for "${summary.connectionId}" failed. The details below are unverified output from the connection attempt:`,
                        summary.lastError
                    )
                        .map((block) => block.text)
                        .join("\n")
                );
            }
        }

        return `Active MongoDB connections:\n${lines.join("\n")}`;
    }
}
