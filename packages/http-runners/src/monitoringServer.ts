import type express from "express";
import type { DefaultMetricDefinitions, ILogger, IMetrics } from "@mongodb-js/mcp-types";
import { LogId } from "@mongodb-js/mcp-core";
import { ExpressBasedHttpServer } from "./expressBasedHttpServer.js";

/**
 * HTTP server that provides monitoring endpoints like health checks and metrics.
 *
 * To customize behavior, extend this class and override methods:
 *
 * @example
 * ```typescript
 * class MyMonitoringServer extends MonitoringServer {
 *   protected override async setupRoutes(): Promise<void> {
 *     // Add custom routes
 *     this.app.get("/custom", (req, res) => res.json({ custom: true }));
 *     await super.setupRoutes();
 *   }
 * }
 * ```
 */
export class MonitoringServer<
    TMetrics extends DefaultMetricDefinitions = DefaultMetricDefinitions,
> extends ExpressBasedHttpServer {
    protected readonly features: MonitoringServerFeature[];
    protected readonly metrics: IMetrics<TMetrics>;

    constructor({ options, logger, metrics }: MonitoringServerOptions<TMetrics>) {
        super({
            options: {
                logContext: "monitoringServer",
                http: { port: options.http.port, host: options.http.host },
            },
            logger,
        });
        this.features = options.features;
        this.metrics = metrics;
    }

    protected override setupRoutes(): Promise<void> {
        if (this.features.includes("health-check")) {
            this.app.get("/health", (_req: express.Request, res: express.Response) => {
                res.json({ status: "ok" });
            });
        }

        if (this.features.includes("metrics")) {
            this.app.get("/metrics", async (_req: express.Request, res: express.Response) => {
                try {
                    const output = await this.metrics.getMetrics();
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
 * Complete constructor params for creating a MonitoringServer instance.
 */
export type MonitoringServerOptions<TMetrics extends DefaultMetricDefinitions = DefaultMetricDefinitions> = {
    /** Options for configuring the monitoring server */
    options: {
        /** HTTP configuration */
        http: {
            /** Host to bind the monitoring server to */
            host: string;
            /** Port to bind the monitoring server to */
            port: number;
        };
        /** Features to enable on the monitoring server */
        features: MonitoringServerFeature[];
    };
    /** Logger for the server */
    logger: ILogger;
    /** Metrics instance */
    metrics: IMetrics<TMetrics>;
};

export type MonitoringServerFeature = "health-check" | "metrics";
