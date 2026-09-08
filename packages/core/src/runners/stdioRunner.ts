import { serveStdio, type StdioServerHandle } from "@modelcontextprotocol/server/stdio";
import type { McpServer } from "@modelcontextprotocol/server";
import type { ITransportRunner } from "@mongodb-js/mcp-types";
import type { CompositeLogger } from "../logging/compositeLogger.js";
import { LogId } from "../logId.js";

/**
 * Transport runner for stdio (standard input/output) transport.
 * This is the default transport for MCP servers.
 *
 * Serves through the SDK's `serveStdio` entry (protocol revision
 * 2026-07-28 and, by default, the 2025-era protocol). The opening exchange
 * selects the connection's era and ONE instance from {@link createServer} is
 * pinned per connection.
 *
 * @example
 * ```typescript
 * class MyStdioRunner extends StdioRunner {
 *   protected override async createServer(): Promise<McpServer> {
 *     return myRegisteredMcpServer;
 *   }
 * }
 *
 * const runner = new MyStdioRunner({ logger: compositeLogger });
 * await runner.start();
 * ```
 */
export abstract class StdioRunner implements ITransportRunner {
    protected readonly logger: CompositeLogger;
    private handle: StdioServerHandle | undefined;

    constructor({ logger }: { logger: CompositeLogger }) {
        this.logger = logger;
    }

    /**
     * Builds a fully-registered {@link McpServer} for one stdio connection.
     * Override this method in subclasses to customize server creation.
     * `serveStdio` calls it once per connection (fresh instance), so each call
     * must build a new server.
     */
    protected abstract createServer(): Promise<McpServer> | McpServer;

    start(): Promise<void> {
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
            // Reject so the top-level CLI handler owns flushing the loggers and
            // exiting, keeping a single shutdown path for every transport.
            return Promise.reject(error instanceof Error ? error : new Error(String(error)));
        }
        return Promise.resolve();
    }

    /**
     * Stops the stdio transport runner.
     * This closes the pinned server instance (if any) and the underlying transport.
     */
    async close(): Promise<void> {
        await this.handle?.close();
    }
}
