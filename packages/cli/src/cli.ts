#!/usr/bin/env node
/* eslint-disable no-console */

import { Keychain, CompositeLogger, StdioRunner } from "@mongodb-js/mcp-core";
import { ConsoleLogger, DiskLogger } from "@mongodb-js/mcp-logging";
import { LogId } from "@mongodb-js/mcp-core";
import { MongoLogManager } from "mongodb-log-writer";
import * as fs from "fs/promises";
import { parseUserConfig } from "./config/parseUserConfig.js";
import { type UserConfig } from "./config/userConfig.js";
import { SessionStore } from "@mongodb-js/mcp-core";
import { StreamableHttpRunner, MCPHttpServer, MonitoringServer } from "@mongodb-js/mcp-http-runners";
import { DryRunModeRunner } from "./transports/dryModeRunner.js";
import type { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { systemCA } from "@mongodb-js/devtools-proxy-support";
import {
    PrometheusMetrics,
    createDefaultMetrics,
    type DefaultPrometheusMetricDefinitions,
} from "@mongodb-js/mcp-metrics";
import type { IMetrics, DefaultMetricDefinitions } from "@mongodb-js/mcp-types";
import type { HttpServerOptions, SessionManagementOptions } from "@mongodb-js/mcp-types";

export type RequestHandler = {
    handleSetup?(config: UserConfig): Promise<void>;
    handleDryRun?(config: UserConfig): Promise<void>;
};

export type ServerFactory<ServerType> = (options: {
    config: UserConfig;
    logger: CompositeLogger;
    metrics: IMetrics<DefaultMetricDefinitions>;
}) => Promise<ServerType>;

export type CLIOptions<ServerType> = {
    packageInfo: { version: string; mcpServerName: string };
    serverFactory: ServerFactory<ServerType>;
    requestHandler?: RequestHandler;
    enableFipsIfRequested?(): void;
};

export async function setupMcpCli<ServerType>(options: CLIOptions<ServerType>): Promise<void> {
    const { packageInfo, serverFactory, requestHandler, enableFipsIfRequested } = options;

    if (enableFipsIfRequested) {
        enableFipsIfRequested();
    }

    systemCA().catch(() => undefined); // load system CA asynchronously as in mongosh

    const args = process.argv.slice(2);
    const isSetupRequested = args[0] === "setup";
    if (isSetupRequested) {
        args.shift();
    }

    const {
        error,
        warnings,
        parsed: config,
    } = parseUserConfig({
        args: process.argv.slice(2),
    });

    if (!config || (error && error.length)) {
        console.error(`${error}
- Refer to https://www.mongodb.com/docs/mcp-server/get-started/ for setting up the MCP Server.`);
        process.exit(1);
    }

    if (warnings && warnings.length) {
        console.warn(`${warnings.join("\n")}
- Refer to https://www.mongodb.com/docs/mcp-server/get-started/ for setting up the MCP Server.`);
    }

    if (config.help) {
        handleHelpRequest();
    }

    if (config.version) {
        handleVersionRequest(packageInfo.version);
    }

    if (isSetupRequested && requestHandler?.handleSetup) {
        await requestHandler.handleSetup(config);
        process.exit(0);
    }

    if (config.dryRun && requestHandler?.handleDryRun) {
        await requestHandler.handleDryRun(config);
        process.exit(0);
    }

    const logger = await createDefaultLoggers(config);
    const metrics = new PrometheusMetrics({ definitions: createDefaultMetrics() });

    let transportRunner: StdioRunner<ServerType> | StreamableHttpRunner<ServerType>;

    if (config.transport === "stdio") {
        const server = await serverFactory({
            config,
            logger,
            metrics,
        });
        transportRunner = new StdioRunner({
            logger: logger,
            server,
        });
    } else {
        const sessionStore = new SessionStore<StreamableHTTPServerTransport>({
            options: {
                idleTimeoutMS: 3600000,
                notificationTimeoutMS: 3000000,
            },
            logger,
            metrics: metrics,
        });

        const mcpHttpServer = new MCPHttpServerWrapper({
            userConfig: config,
            serverFactory,
            options: {
                http: {
                    host: config.httpHost,
                    port: config.httpPort,
                    responseType: config.httpResponseType,
                    headers: config.httpHeaders,
                },
                session: {
                    externallyManagedSessions: config.externallyManagedSessions,
                    idleTimeoutMs: 3600000,
                    notificationTimeoutMs: 3000000,
                },
            },
            logger,
            metrics: metrics,
            sessionStore,
        });

        let monitoringServer: MonitoringServer | undefined;
        if (config.monitoringServerHost && config.monitoringServerPort) {
            monitoringServer = new MonitoringServer<DefaultPrometheusMetricDefinitions>({
                options: {
                    http: {
                        host: config.monitoringServerHost,
                        port: config.monitoringServerPort,
                    },
                    features: config.monitoringServerFeatures,
                },
                logger,
                metrics: metrics,
            });
        }

        transportRunner = new StreamableHttpRunner({
            logger,
            metrics,
            mcpHttpServer,
            monitoringServer,
            sessionStore,
        });
    }

    const shutdown = async (): Promise<void> => {
        logger.info({
            id: LogId.serverCloseRequested,
            context: "server",
            message: `Server close requested`,
        });

        try {
            await transportRunner.close();
        } catch (error: unknown) {
            logger.error({
                id: LogId.serverCloseFailure,
                context: "server",
                message: `Error closing server: ${error as string}`,
            });
            process.exit(1);
        } finally {
            logger.info({
                id: LogId.serverClosed,
                context: "server",
                message: `Server closed`,
            });
            await logger.flush();
            process.exit(0);
        }
    };

    process.on("SIGINT", () => void shutdown());
    process.on("SIGABRT", () => void shutdown());
    process.on("SIGTERM", () => void shutdown());
    process.on("SIGQUIT", () => void shutdown());

    try {
        await transportRunner.start();
    } catch (error: unknown) {
        logger.info({
            id: LogId.serverCloseRequested,
            context: "server",
            message: `Closing server due to error: ${error as string}`,
        });

        try {
            await transportRunner.close();
            logger.info({
                id: LogId.serverClosed,
                context: "server",
                message: "Server closed",
            });
        } catch (error: unknown) {
            logger.error({
                id: LogId.serverCloseFailure,
                context: "server",
                message: `Error closing server: ${error as string}`,
            });
        }
        throw error;
    }
}

class MCPHttpServerWrapper<ServerType> extends MCPHttpServer<ServerType> {
    private userConfig: UserConfig;
    private baseLogger: CompositeLogger;
    private serverFactory: ServerFactory<ServerType>;

    constructor({
        userConfig,
        serverFactory,
        options,
        logger,
        metrics,
        sessionStore,
    }: {
        userConfig: UserConfig;
        serverFactory: ServerFactory<ServerType>;
        options: {
            http: HttpServerOptions;
            session: SessionManagementOptions;
        };
        logger: CompositeLogger;
        metrics: IMetrics<DefaultMetricDefinitions>;
        sessionStore: SessionStore<StreamableHTTPServerTransport>;
    }) {
        super({ options, logger, metrics, sessionStore });
        this.userConfig = userConfig;
        this.baseLogger = logger;
        this.serverFactory = serverFactory;
    }

    protected override async createServerForRequest(): Promise<ServerType> {
        return this.serverFactory({
            config: this.userConfig,
            logger: this.baseLogger,
            metrics: this.metrics,
        });
    }
}

export function handleHelpRequest(): never {
    console.log("For usage information refer to the README.md:");
    console.log("https://github.com/mongodb-js/mongodb-mcp-server?tab=readme-ov-file#quick-start");
    process.exit(0);
}

export function handleVersionRequest(version: string): never {
    console.log(version);
    process.exit(0);
}

export async function createDefaultLoggers(config: UserConfig): Promise<CompositeLogger> {
    const baseLoggers: (ConsoleLogger | DiskLogger)[] = [];

    if (config.loggers.includes("stderr")) {
        baseLoggers.push(new ConsoleLogger({ keychain: Keychain.root }));
    }

    if (config.loggers.includes("disk")) {
        await fs.mkdir(config.logPath, { recursive: true });

        const manager = new MongoLogManager({
            directory: config.logPath,
            retentionDays: 30,
            onwarn: console.warn,
            onerror: console.error,
            gzip: false,
            retentionGB: 1,
        });

        await manager.cleanupOldLogFiles();
        const logWriter = await manager.createLogWriter();

        baseLoggers.push(
            new DiskLogger({
                logWriter,
                keychain: Keychain.root,
            })
        );
    }

    // Wrap all base loggers in a single CompositeLogger array
    return new CompositeLogger({ loggers: baseLoggers });
}

export async function handleDryRun<ServerType>(
    config: UserConfig,
    serverFactory: ServerFactory<ServerType>
): Promise<never> {
    try {
        const metrics = new PrometheusMetrics({ definitions: createDefaultMetrics() });
        const consoleLogger = new ConsoleLogger({ keychain: Keychain.root });
        const compositeLogger = new CompositeLogger({ loggers: [consoleLogger] });

        // Create the server instance
        const server = await serverFactory({ config, logger: compositeLogger, metrics });

        const runner = new DryRunModeRunner({
            logger: {
                log: console.log,
                error: console.error,
            },
            userConfig: config,
            server,
        });
        await runner.start();
        await runner.stop();
        process.exit(0);
    } catch (error) {
        console.error(`Fatal error running server in dry run mode: ${error as string}`);
        process.exit(1);
    }
}

export { parseUserConfig, type UserConfig };
export { TRANSPORT_PAYLOAD_LIMITS, type TransportType } from "./transports/constants.js";
export {
    commaSeparatedToArray,
    parseBoolean,
    oneWayOverride,
    onlyLowerThanBaseValueOverride,
    onlyStricterLogLevelOverride,
    onlySubsetOfBaseValueOverride,
    type CustomOverrideLogic,
    type OverrideBehavior,
    type ConfigFieldMeta,
} from "./config/configUtils.js";
