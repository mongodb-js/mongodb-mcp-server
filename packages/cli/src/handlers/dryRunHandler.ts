/* eslint-disable no-console */
import type { CliHandler } from "./types.js";
import type { UserConfig } from "../config/userConfig.js";
import { ConsoleLogger } from "@mongodb-js/mcp-logging";
import { CompositeLogger } from "@mongodb-js/mcp-core";
import { PrometheusMetrics, createDefaultMetrics } from "@mongodb-js/mcp-metrics";
import { DryRunModeRunner } from "../transports/dryModeRunner.js";
import type { IMetrics, DefaultMetricDefinitions } from "@mongodb-js/mcp-types";
import type { CompositeLogger as CompositeLoggerType } from "@mongodb-js/mcp-core";

export type ServerCreator = (options: {
    config: UserConfig;
    logger: CompositeLoggerType;
    metrics: IMetrics<DefaultMetricDefinitions>;
}) => Promise<{ connect(transport: any): Promise<void>; close(): Promise<void> }>;

export class DryRunHandler implements CliHandler {
    private createServer: ServerCreator;

    constructor(createServer: ServerCreator) {
        this.createServer = createServer;
    }

    shouldHandle(config: UserConfig): boolean {
        return config.dryRun === true;
    }

    async handle(config: UserConfig): Promise<void> {
        await this.handleDryRun(config);
    }

    private async handleDryRun(config: UserConfig): Promise<never> {
        try {
            const metrics = new PrometheusMetrics({ definitions: createDefaultMetrics() });
            const consoleLogger = new ConsoleLogger({ keychain: {} as any });
            const compositeLogger = new CompositeLogger({ loggers: [consoleLogger] });

            const server = await this.createServer({ config, logger: compositeLogger, metrics });

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
        } catch (error) {
            console.error(`Fatal error running server in dry run mode: ${error as string}`);
            process.exit(1);
        }
    }
}

export async function handleDryRun(
    config: UserConfig,
    createServer: ServerCreator
): Promise<never> {
    const handler = new DryRunHandler(createServer);
    await handler.handle(config);
    process.exit(0);
}
