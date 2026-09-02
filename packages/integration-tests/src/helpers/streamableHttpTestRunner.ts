import { StreamableHttpRunner, MCPHttpServer, type MonitoringServer } from "@mongodb-js/mcp-http-runners";
import { CompositeLogger, type LoggerBase, type AnyToolClass } from "@mongodb-js/mcp-core";
import { createMonitoringServerFromConfig } from "@mongodb-js/mcp-cli";
import {
    PrometheusMetrics,
    createDefaultMetrics,
    type DefaultPrometheusMetricDefinitions,
} from "@mongodb-js/mcp-metrics";
import type {
    TransportRequestContext,
    HttpServerOptions,
    IMetrics,
    DefaultMetricDefinitions,
} from "@mongodb-js/mcp-types";
import type { UserConfig } from "mongodb-mcp-server";
import type { CliServer } from "mongodb-mcp-server";
import { createTestServer } from "./createTestServer.js";

export type CreateStreamableHttpTestRunnerOptions = {
    /** Tool constructors to register on per-request servers. Defaults to `AllTools` via {@link createTestServer}. */
    tools?: AnyToolClass[];
    /** Custom metrics instance to use for the runner, monitoring server and per-request servers. */
    customMetrics?: PrometheusMetrics<DefaultPrometheusMetricDefinitions>;
    /** Additional loggers to attach to the runner's composite logger. */
    loggers?: LoggerBase[];
    /**
     * Custom per-request server factory, overriding the default
     * `createTestServer(config, { tools, metrics })` behavior (e.g. to apply
     * config modifications per request).
     */
    createServer?: (config: UserConfig) => Promise<CliServer>;
    /** Set to `false` to skip creating a monitoring server from the config (default: `true`). */
    enableMonitoringServer?: boolean;
};

export type StreamableHttpTestRunnerComponents = {
    runner: StreamableHttpRunner<CliServer>;
    monitoringServer: MonitoringServer | undefined;
    getServerAddress: () => string;
};

/**
 * Custom MCPHttpServer that creates a test server per request.
 *
 * Exposed so tests can subclass it (e.g. to add middleware) or construct it
 * directly.
 */
export class TestMCPHttpServer extends MCPHttpServer<CliServer> {
    private readonly userConfig: UserConfig;
    private readonly tools?: AnyToolClass[];
    private readonly customMetrics?: PrometheusMetrics<DefaultPrometheusMetricDefinitions>;
    private readonly createServer?: (config: UserConfig) => Promise<CliServer>;

    constructor({
        userConfig,
        options,
        logger,
        metrics,
        tools,
        customMetrics,
        createServer,
    }: {
        userConfig: UserConfig;
        options: {
            http: HttpServerOptions;
        };
        logger: CompositeLogger;
        metrics: IMetrics<DefaultMetricDefinitions>;
        tools?: AnyToolClass[];
        customMetrics?: PrometheusMetrics<DefaultPrometheusMetricDefinitions>;
        createServer?: (config: UserConfig) => Promise<CliServer>;
    }) {
        super({ options, logger, metrics });
        this.userConfig = userConfig;
        this.tools = tools;
        this.customMetrics = customMetrics;
        this.createServer = createServer;
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    protected override async createServerForRequest(_: TransportRequestContext): Promise<CliServer> {
        if (this.createServer) {
            return this.createServer(this.userConfig);
        }
        return createTestServer(this.userConfig, {
            tools: this.tools,
            metrics:
                this.customMetrics ??
                (this.metrics as unknown as PrometheusMetrics<DefaultPrometheusMetricDefinitions>),
        });
    }
}

/** Returns the address of the underlying MCP HTTP server. */
export function getServerAddress(runner: StreamableHttpRunner<CliServer>): string {
    const mcpHttpServer = (runner as unknown as { mcpHttpServer: { serverAddress: string } }).mcpHttpServer;
    return mcpHttpServer.serverAddress;
}

/**
 * Creates a fully wired `StreamableHttpRunner` for tests, with per-request
 * `CliServer` creation and an optional monitoring server derived from the
 * config.
 */
export function createStreamableHttpTestRunner(
    config: UserConfig,
    options: CreateStreamableHttpTestRunnerOptions = {}
): StreamableHttpTestRunnerComponents {
    const logger = new CompositeLogger({ loggers: options.loggers ?? [] });
    const metrics = options.customMetrics ?? new PrometheusMetrics({ definitions: createDefaultMetrics() });

    const mcpHttpServer = new TestMCPHttpServer({
        userConfig: config,
        options: {
            http: {
                host: config.httpHost,
                port: config.httpPort,
                bodyLimit: config.httpBodyLimit,
                headers: config.httpHeaders,
                responseType: config.httpResponseType,
                authMode: "unauthenticated",
            },
        },
        logger,
        metrics: metrics,
        tools: options.tools,
        customMetrics: options.customMetrics,
        createServer: options.createServer,
    });

    const monitoringServer =
        options.enableMonitoringServer === false
            ? undefined
            : createMonitoringServerFromConfig({ config, logger, metrics });

    const runner = new StreamableHttpRunner<CliServer>({
        logger,
        mcpHttpServer,
        monitoringServer: monitoringServer,
    });

    return {
        runner,
        monitoringServer,
        getServerAddress: () => getServerAddress(runner),
    };
}
