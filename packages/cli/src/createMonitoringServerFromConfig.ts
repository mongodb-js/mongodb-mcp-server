import type { CompositeLogger } from "@mongodb-js/mcp-core";
import { MonitoringServer } from "@mongodb-js/mcp-http-runners";
import type { DefaultMetricDefinitions, IMetrics } from "@mongodb-js/mcp-types";
import type { UserConfig } from "./config/userConfig.js";

export type CreateMonitoringServerFromConfigOptions = {
    config: UserConfig;
    logger: CompositeLogger;
    metrics: IMetrics<DefaultMetricDefinitions>;
};

export function validateMonitoringServerConfig(config: UserConfig): void {
    if ((config.monitoringServerHost === undefined) !== (config.monitoringServerPort === undefined)) {
        throw new Error(
            "Both monitoringServerHost and monitoringServerPort must be defined to enable the monitoring server."
        );
    }

    if ((config.healthCheckHost === undefined) !== (config.healthCheckPort === undefined)) {
        throw new Error("Both healthCheckHost and healthCheckPort must be defined to enable health checks.");
    }
}

export function createMonitoringServerFromConfig({
    config,
    logger,
    metrics,
}: CreateMonitoringServerFromConfigOptions): MonitoringServer | undefined {
    validateMonitoringServerConfig(config);

    const host = config.monitoringServerHost ?? config.healthCheckHost;
    const port = config.monitoringServerPort ?? config.healthCheckPort;

    if (host === undefined || port === undefined) {
        return undefined;
    }

    return new MonitoringServer({
        options: {
            http: {
                host,
                port,
            },
            features: config.monitoringServerFeatures,
        },
        logger,
        metrics,
    });
}
