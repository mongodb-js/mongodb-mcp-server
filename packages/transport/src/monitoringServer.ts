import express from "express";
import type { LoggerBase } from "./types.js";
import type { Metrics, DefaultMetrics } from "@mongodb-mcp/monitoring";
import { ExpressBasedHttpServer } from "./expressServer.js";

export type MonitoringServerFeature = "health-check" | "metrics";

export interface MonitoringServerConfig {
    monitoringServerHost?: string;
    monitoringServerPort?: number;
    healthCheckHost?: string;
    healthCheckPort?: number;
    monitoringServerFeatures: MonitoringServerFeature[];
}

export interface MonitoringServerConstructorArgs<TMetrics extends DefaultMetrics = DefaultMetrics> {
    host: string;
    port: number;
    features: MonitoringServerFeature[];
    logger: LoggerBase;
    metrics: Metrics<TMetrics>;
}

export class MonitoringServer<TMetrics extends DefaultMetrics = DefaultMetrics> extends ExpressBasedHttpServer {
    private readonly features: MonitoringServerFeature[];
    private readonly metrics: Metrics<TMetrics>;

    constructor({
        host,
        port,
        features,
        logger,
        metrics,
    }: MonitoringServerConstructorArgs<TMetrics>) {
        super({ port, hostname: host, logger, logContext: "monitoringServer" });
        this.features = features;
        this.metrics = metrics;
    }

    protected override async setupRoutes(): Promise<void> {
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
                        id: "metricsError",
                        context: "metrics",
                        message: `Failed to retrieve metrics: ${String(error)}`,
                    });
                    res.status(500).json({ error: "Failed to retrieve metrics" });
                }
            });
        }
    }
}

export function createDefaultMonitoringServer<TMetrics extends DefaultMetrics = DefaultMetrics>(
    args: MonitoringServerConstructorArgs<TMetrics>
): MonitoringServer<TMetrics> {
    return new MonitoringServer(args);
}
