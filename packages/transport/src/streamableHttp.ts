import { TransportRunnerBase, type TransportRunnerConfig } from "./base.js";
import type { DefaultMetrics } from "./types.js";
import { MCPHttpServer } from "./mcpHttpServer.js";
import {
    MonitoringServer,
    createDefaultMonitoringServer,
    type MonitoringServerConfig,
    type MonitoringServerFeature,
    type MonitoringServerConstructorArgs,
} from "./monitoringServer.js";

export type StreamableHttpTransportRunnerConfig<TMetrics extends DefaultMetrics = DefaultMetrics> = {
    mcpHttpServer: MCPHttpServer;
    monitoringServer?: MonitoringServer<TMetrics>;
} & TransportRunnerConfig<TMetrics>;

export class StreamableHttpRunner<
    TMetrics extends DefaultMetrics = DefaultMetrics,
> extends TransportRunnerBase<TMetrics> {
    private readonly mcpServer: MCPHttpServer;
    private readonly monitoringServer: MonitoringServer<TMetrics> | undefined;

    constructor({ mcpHttpServer, monitoringServer, ...options }: StreamableHttpTransportRunnerConfig<TMetrics>) {
        super(options);
        this.mcpServer = mcpHttpServer;
        this.monitoringServer = monitoringServer;
    }

    async start(): Promise<void> {
        await this.mcpServer.start();
        await this.monitoringServer?.start();

        this.logger.info({
            id: "streamableHttpTransportStarted",
            context: "transport",
            message: "Streamable HTTP Transport started",
        });
    }

    async closeTransport(): Promise<void> {
        await Promise.all([this.mcpServer.stop(), this.monitoringServer?.stop()]);
    }
}

export {
    MonitoringServer,
    createDefaultMonitoringServer,
    type MonitoringServerConfig,
    type MonitoringServerFeature,
    type MonitoringServerConstructorArgs,
};
