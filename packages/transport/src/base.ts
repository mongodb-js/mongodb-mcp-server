import type { LoggerBase, DeviceId } from "./types.js";
import type { Metrics, DefaultMetrics } from "@mongodb-mcp/monitoring";

export interface TransportRunnerConfig<TMetrics extends DefaultMetrics = DefaultMetrics> {
    logger: LoggerBase;
    deviceId: DeviceId;
    metrics: Metrics<TMetrics>;
}

export abstract class TransportRunnerBase<TMetrics extends DefaultMetrics = DefaultMetrics> {
    protected readonly logger: LoggerBase;
    protected readonly deviceId: DeviceId;
    protected readonly metrics: Metrics<TMetrics>;

    constructor(config: TransportRunnerConfig<TMetrics>) {
        this.logger = config.logger;
        this.deviceId = config.deviceId;
        this.metrics = config.metrics;
    }

    abstract start(): Promise<void>;

    abstract closeTransport(): Promise<void>;

    async close(): Promise<void> {
        await this.closeTransport();
    }
}
