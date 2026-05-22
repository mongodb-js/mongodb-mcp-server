import type { CompositeLogger } from "@mongodb-js/mcp-core";
import { MonitoringServer } from "@mongodb-js/mcp-http-runners";
import type { DefaultMetricDefinitions, IMetrics } from "@mongodb-js/mcp-types";
import type { UserConfig } from "./config/userConfig.js";

export type CreateMonitoringServerFromConfigOptions = {
    config: UserConfig;
    logger: CompositeLogger;
    metrics: IMetrics<DefaultMetricDefinitions>;
};

export function createMonitoringServerFromConfig({
    config,
    logger,
    metrics,
}: CreateMonitoringServerFromConfigOptions): MonitoringServer | undefined {
    if (!config.monitoringServerHost || !config.monitoringServerPort) {
        return undefined;
    }

    return new MonitoringServer({
        options: {
            http: {
                host: config.monitoringServerHost,
                port: config.monitoringServerPort,
            },
            features: config.monitoringServerFeatures,
        },
        logger,
        metrics,
    });
}
