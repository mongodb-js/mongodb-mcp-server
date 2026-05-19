/* eslint-disable no-console */
import type { CliHandler } from "./types.js";
import type { UserConfig } from "../config/userConfig.js";
import { ConsoleLogger } from "@mongodb-js/mcp-logging";
import { CompositeLogger } from "@mongodb-js/mcp-core";
import { PrometheusMetrics, createDefaultMetrics } from "@mongodb-js/mcp-metrics";
import { DryRunModeRunner } from "../transports/dryModeRunner.js";
import type { SessionAwareServer } from "@mongodb-js/mcp-http-runners";

export type CreateServerFunction = (config: UserConfig) => Promise<SessionAwareServer>;

export class DryRunHandler implements CliHandler {
    private createServer: CreateServerFunction;

    constructor(createServer: CreateServerFunction) {
        this.createServer = createServer;
    }

    shouldHandle(config: UserConfig): boolean {
        return config.dryRun === true;
    }

    async handle(config: UserConfig): Promise<void> {
        const metrics = new PrometheusMetrics({ definitions: createDefaultMetrics() });
        const consoleLogger = new ConsoleLogger({ keychain: {} as any });
        const compositeLogger = new CompositeLogger({ loggers: [consoleLogger] });

        const server = await this.createServer(config);

        const runner = new DryRunModeRunner({
            logger: {
                log: console.log,
                error: console.error,
            },
            userConfig: config,
            server,
        });
        await runner.start();
        await runner.stop();
        process.exit(0);
    }
}
