import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { ITransportRunner } from "@mongodb-js/mcp-types";
import type { CompositeLogger } from "../logging/compositeLogger.js";
import { LogId } from "../logId.js";

/**
 * Transport runner for stdio (standard input/output) transport.
 * This is the default transport for MCP servers.
 *
 * @example
 * ```typescript
 * const runner = new StdioRunner({
 *   logger: compositeLogger,
 *   server: myServer,
 * });
 * await runner.start();
 * ```
 */
export class StdioRunner<
    TServer extends {
        connect(transport: StdioServerTransport): Promise<void>;
        close(): Promise<void>;
    } = {
        connect(transport: StdioServerTransport): Promise<void>;
        close(): Promise<void>;
    },
> implements ITransportRunner {
    private server: TServer;
    public readonly logger: CompositeLogger;

    constructor({ logger, server }: { logger: CompositeLogger; server: TServer }) {
        this.logger = logger;
        this.server = server;
    }

    async start(): Promise<void> {
        try {
            const transport = new StdioServerTransport();
            await this.server.connect(transport);
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
     * This closes the server connection.
     */
    async close(): Promise<void> {
        await this.server.close();
    }
}
