import { LogId } from "@mongodb-js/mcp-core";
import type { StdioRunner } from "@mongodb-js/mcp-core";
import type { StreamableHttpRunner } from "@mongodb-js/mcp-http-runners";
import type { CompositeLogger } from "@mongodb-js/mcp-core";
import type { OnExit } from "./types.js";

export type StartRunnerOptions = {
    transportRunner: StdioRunner | StreamableHttpRunner;
    logger: CompositeLogger;
    onExit: OnExit;
};

/**
 * Starts the given transport runner and manages the server lifecycle:
 * registers signal handlers for graceful shutdown and ensures the runner is
 * closed on start failure.
 */
export async function startRunner({ transportRunner, logger, onExit }: StartRunnerOptions): Promise<void> {
    const shutdown = async (): Promise<void> => {
        logger.info({
            id: LogId.serverCloseRequested,
            context: "server",
            message: `Server close requested`,
        });

        try {
            await transportRunner.close();
        } catch (error: unknown) {
            logger.error({
                id: LogId.serverCloseFailure,
                context: "server",
                message: `Error closing server: ${error as string}`,
            });
            onExit(1);
        } finally {
            logger.info({
                id: LogId.serverClosed,
                context: "server",
                message: `Server closed`,
            });
            await logger.flush();
            onExit(0);
        }
    };

    process.on("SIGINT", () => void shutdown());
    process.on("SIGABRT", () => void shutdown());
    process.on("SIGTERM", () => void shutdown());
    process.on("SIGQUIT", () => void shutdown());

    try {
        await transportRunner.start();
    } catch (error: unknown) {
        logger.info({
            id: LogId.serverCloseRequested,
            context: "server",
            message: `Closing server due to error: ${error as string}`,
        });

        try {
            await transportRunner.close();
            logger.info({
                id: LogId.serverClosed,
                context: "server",
                message: "Server closed",
            });
        } catch (error: unknown) {
            logger.error({
                id: LogId.serverCloseFailure,
                context: "server",
                message: `Error closing server: ${error as string}`,
            });
        }
        throw error;
    }
}
