import { CompositeLogger, ConsoleLogger, DiskLogger, type LoggerBase } from "../common/logging/index.js";
import { Keychain } from "../common/keychain.js";
import type { UserConfig } from "../common/config/userConfig.js";
import { MonitoringServer } from "./streamableHttp.js";
import type { DefaultMetrics } from "../common/metrics/index.js";
import type { Metrics } from "../common/metrics/metricsTypes.js";

/**
 * Creates a logger from user configuration.
 * Constructs a CompositeLogger with ConsoleLogger and/or DiskLogger based on config.loggers.
 */
export function createLoggerFromConfig(config: UserConfig): CompositeLogger {
    const loggers: LoggerBase[] = [];
    if (config.loggers.includes("stderr")) {
        loggers.push(new ConsoleLogger(Keychain.root));
    }

    if (config.loggers.includes("disk")) {
        loggers.push(
            new DiskLogger(
                config.logPath,
                (err) => {
                    // eslint-disable-next-line no-console
                    console.error("Error initializing disk logger:", err);
                    process.exit(1);
                },
                Keychain.root
            )
        );
    }

    return new CompositeLogger(...loggers);
}

/**
 * Creates a monitoring server from user configuration if monitoring is enabled.
 * Returns undefined if no monitoring host/port is configured.
 */
export function createMonitoringServerFromConfig<TMetrics extends DefaultMetrics>(
    config: UserConfig,
    logger: LoggerBase,
    metrics: Metrics<TMetrics>
): MonitoringServer<TMetrics> | undefined {
    const host = config.monitoringServerHost ?? config.healthCheckHost;
    const port = config.monitoringServerPort ?? config.healthCheckPort;
    if (host !== undefined && port !== undefined) {
        return new MonitoringServer({
            host,
            port,
            features: config.monitoringServerFeatures,
            logger,
            metrics,
        });
    }
    return undefined;
}
