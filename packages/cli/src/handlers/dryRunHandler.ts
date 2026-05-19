import type { Handler, ConsoleLogger, OnExit } from "../types.js";
import type { UserConfig } from "../config/userConfig.js";
import { DryRunModeRunner, type DryRunServer } from "../transports/dryModeRunner.js";

/**
 * Handler for --dryRun mode. Dumps the effective configuration and enabled
 * tools to stdout, then exits without starting the server.
 *
 * @example
 * ```typescript
 * const { server, config, logger, metrics } = await createServicesFromUserConfig({ ... });
 *
 * await runMcpCli({
 *   handlers: [new DryRunHandler({ server })],
 *   server,
 *   config,
 *   ...
 * });
 * ```
 */
export class DryRunHandler implements Handler {
    private server: DryRunServer;

    constructor({ server }: { server: DryRunServer }) {
        this.server = server;
    }

    shouldHandle(config: UserConfig): boolean {
        return config.dryRun === true;
    }

    async handle(config: UserConfig, consoleLogger: ConsoleLogger, onExit: OnExit): Promise<void> {
        try {
            const runner = new DryRunModeRunner({
                logger: consoleLogger,
                userConfig: config,
                server: this.server,
            });
            await runner.start();
            onExit(0);
        } catch (error) {
            consoleLogger.error(`Fatal error running server in dry run mode: ${error as string}`);
            onExit(1);
        }
    }
}
