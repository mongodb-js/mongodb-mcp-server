import { MonitoringServer } from "@mongodb-mcp/transport";
import type { LoggerBase } from "../common/logging/index.js";
import type { UserConfig } from "../common/config/userConfig.js";
import type { Metrics, DefaultMetrics } from "@mongodb-mcp/monitoring";
import { createDefaultSessionStore, type ISessionStore } from "@mongodb-mcp/transport";
import type { CloseableTransport } from "@mongodb-mcp/transport";
import { CompositeLogger, ConsoleLogger, DiskLogger } from "../common/logging/index.js";
import { Keychain } from "../common/keychain.js";

export function createLoggerFromConfig(config: UserConfig): LoggerBase {
    const loggers: LoggerBase[] = [];

    if (config.loggers.includes("stderr")) {
        loggers.push(new ConsoleLogger(Keychain.root));
    }

    if (config.loggers.includes("disk") && config.logPath) {
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

export function createSessionStoreFromConfig<T extends CloseableTransport>(
    config: UserConfig,
    logger: LoggerBase,
    metrics: Metrics<DefaultMetrics>
): ISessionStore<T> {
    return createDefaultSessionStore({
        idleTimeoutMs: config.idleTimeoutMs,
        notificationTimeoutMs: config.notificationTimeoutMs,
        logger,
        metrics,
    });
}
