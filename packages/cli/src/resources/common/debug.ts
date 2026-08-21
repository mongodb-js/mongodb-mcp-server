import { ReactiveResource, formatUntrustedData } from "@mongodb-js/mcp-core";
import type { ITelemetry } from "@mongodb-js/mcp-types";
import { connectCapableTools, summarizeConnection } from "@mongodb-js/mcp-tools-mongodb";
import type { McpSession, CliServer } from "@mongodb-js/mcp-cli";

export class DebugResource extends ReactiveResource<undefined, readonly [], McpSession, CliServer> {
    constructor(session: McpSession, telemetry: ITelemetry) {
        super({
            resourceConfiguration: {
                name: "debug-mongodb",
                uri: "debug://mongodb",
                config: {
                    description:
                        "Debugging information for MongoDB connectivity issues. Lists the active connections, their state, and the error from their last failed connection attempt.",
                },
            },
            options: {
                initial: undefined,
                events: [],
            },
            session,
            telemetry,
        });
    }

    async toOutput(): Promise<string> {
        const entries = await this.session.connectionRegistry.find(() => true);
        if (entries.length === 0) {
            const connectToolNames = connectCapableTools(this.server?.tools ?? [])
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
