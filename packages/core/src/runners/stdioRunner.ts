import { serveStdio, type StdioServerHandle } from "@modelcontextprotocol/server/stdio";
import type { McpServer } from "@modelcontextprotocol/server";
import type { ITransportRunner } from "@mongodb-js/mcp-types";
import type { CompositeLogger } from "../logging/compositeLogger.js";
import { LogId } from "../logId.js";

/**
 * A server factory returning a fully-registered {@link McpServer} for one stdio
 * connection. `serveStdio` calls it once per connection (fresh instance), so the
 * factory must build a new server each time it is invoked.
 */
export type StdioServerFactory = () => Promise<McpServer> | McpServer;

/**
 * Transport runner for stdio (standard input/output) transport.
 * This is the default transport for MCP servers.
 *
 * Serves through the SDK's `serveStdio` entry (protocol revision
 * 2026-07-28 and, by default, the 2025-era protocol). The opening exchange
 * selects the connection's era and ONE instance from the factory is pinned
 * per connection.
 *
 * @example
 * ```typescript
 * const runner = new StdioRunner({
 *   logger: compositeLogger,
 *   createServer: async () => myRegisteredMcpServer,
 * });
 * await runner.start();
 * ```
 */
export class StdioRunner implements ITransportRunner {
    protected readonly logger: CompositeLogger;
    protected readonly createServer: StdioServerFactory;
    private handle: StdioServerHandle | undefined;

    constructor({ logger, createServer }: { logger: CompositeLogger; createServer: StdioServerFactory }) {
        this.logger = logger;
        this.createServer = createServer;
    }

    async start(): Promise<void> {
        try {
            this.handle = serveStdio(() => this.createServer(), {
                onerror: (error: Error) => {
                    this.logger.error({
                        id: LogId.serverStartFailure,
                        context: "server",
                        message: `Stdio server error: ${error instanceof Error ? error.message : String(error)}`,
                    });
                },
            });
        } catch (error: unknown) {
            this.logger.emergency({
                id: LogId.serverStartFailure,
                context: "server",
                message: `Fatal error running server: ${error as string}`,
            });
            process.exit(1);
        }
    }

    /**
     * Stops the stdio transport runner.
     * This closes the pinned server instance (if any) and the underlying transport.
     */
    async close(): Promise<void> {
        await this.handle?.close();
    }
}
