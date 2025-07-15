#!/usr/bin/env node

import logger, { LogId } from "./common/logger.js";
import { config } from "./common/config.js";
import { StdioRunner } from "./transports/stdio.js";
import { StreamableHttpRunner } from "./transports/streamableHttp.js";

async function main() {
    const runner = config.transport === "stdio" ? new StdioRunner() : new StreamableHttpRunner();

    const shutdown = async () => {
        logger.info(LogId.serverCloseRequested, "server", `Server close requested`);

        try {
            const exitCode = await runner.close();
            process.exit(exitCode);
        } catch (error: unknown) {
            logger.error(LogId.serverCloseFailure, "server", `Error closing server: ${error as string}`);
            process.exit(1);
        }
    };

    process.once("SIGINT", shutdown);
    process.once("SIGABRT", shutdown);
    process.once("SIGTERM", shutdown);
    process.once("SIGQUIT", shutdown);

    try {
        await runner.run();
    } catch (error: unknown) {
        logger.emergency(LogId.serverStartFailure, "server", `Fatal error running server: ${error as string}`);
        try {
            await runner.close();
        } catch (error: unknown) {
            logger.error(LogId.serverCloseFailure, "server", `Error closing server: ${error as string}`);
        } finally {
            process.exit(1);
        }
    }
}

main().catch((error: unknown) => {
    logger.emergency(LogId.serverStartFailure, "server", `Fatal error running server: ${error as string}`);
    process.exit(1);
});
