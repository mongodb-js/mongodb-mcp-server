import type express from "express";
import { LogId } from "@mongodb-js/mcp-logging";
import type {
    DefaultMetrics,
    MonitoringServerFeature,
    Metrics,
    LoggerBase,
    UserConfig,
    MonitoringServerConstructorArgs,
} from "../lib.js";
import { ExpressBasedHttpServer } from "./expressBasedHttpServer.js";

export class MonitoringServer<TMetrics extends DefaultMetrics = DefaultMetrics> extends ExpressBasedHttpServer {
    private readonly features: MonitoringServerFeature[];
    private readonly metrics: Metrics<TMetrics>;

    constructor({
        host,
        port,
        features,
        logger,
        metrics,
    }: {
        host: string;
        port: number;
        features: MonitoringServerFeature[];
        logger: LoggerBase;
        metrics: Metrics<TMetrics>;
    }) {
        super({ port, hostname: host, logger, logContext: "monitoringServer" });
        this.features = features;
        this.metrics = metrics;
    }

    static fromConfig<TMetrics extends DefaultMetrics = DefaultMetrics>({
        userConfig,
        logger,
        metrics,
    }: {
        userConfig: UserConfig;
        logger: LoggerBase;
        metrics: Metrics<TMetrics>;
    }): MonitoringServer<TMetrics> | undefined {
        const host = userConfig.monitoringServerHost ?? userConfig.healthCheckHost;
        const port = userConfig.monitoringServerPort ?? userConfig.healthCheckPort;
        if (host === undefined || port === undefined) {
            return undefined;
        }

        return new MonitoringServer({ host, port, features: userConfig.monitoringServerFeatures, logger, metrics });
    }

    protected override setupRoutes(): Promise<void> {
        if (this.features.includes("health-check")) {
            this.app.get("/health", (_req: express.Request, res: express.Response) => {
                res.json({ status: "ok" });
            });
        }

        if (this.features.includes("metrics") && this.metrics?.getMetrics) {
            const getMetrics = this.metrics.getMetrics.bind(this.metrics);
            this.app.get("/metrics", async (_req: express.Request, res: express.Response) => {
                try {
                    const output = await getMetrics();
                    res.set("Content-Type", "text/plain");
                    res.send(output);
                } catch (error: unknown) {
                    this.logger.error({
                        id: LogId.monitoringServerMetricsFailure,
                        context: "monitoringServer",
                        message: `Failed to retrieve metrics: ${String(error)}`,
                    });
                    res.status(500).json({ error: "Failed to retrieve metrics" });
                }
            });
        }

        return Promise.resolve();
    }
}

/**
 * A function to create a custom MonitoringServer instance.
 * When provided, the runner will use this function instead of the default MonitoringServer constructor.
 */
export type CreateMonitoringServerFn<TMetrics extends DefaultMetrics = DefaultMetrics> = (
    args: MonitoringServerConstructorArgs<TMetrics>
) => MonitoringServer<TMetrics> | undefined;

/**
 * Creates a default MonitoringServer instance from the provided constructor arguments.
 */
export const createDefaultMonitoringServer: <TMetrics extends DefaultMetrics = DefaultMetrics>(
    args: MonitoringServerConstructorArgs<TMetrics>
) => MonitoringServer<TMetrics> = <TMetrics extends DefaultMetrics = DefaultMetrics>(
    args: MonitoringServerConstructorArgs<TMetrics>
) => new MonitoringServer<TMetrics>(args);
