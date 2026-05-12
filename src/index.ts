#!/usr/bin/env node
/* eslint-disable no-console */

function enableFipsIfRequested(): void {
    let fipsError: Error | undefined;
    const tlsFIPSMode = process.argv.includes("--tlsFIPSMode");

    if (tlsFIPSMode) {
        try {
            // eslint-disable-next-line
            require("crypto").setFips(1);
        } catch (err: unknown) {
            fipsError ??= err as Error;
        }
    }

    if (tlsFIPSMode) {
        if (!fipsError && !crypto.getFips()) {
            fipsError = new Error("FIPS mode not enabled despite requested due to unknown error.");
        }
    }

    if (fipsError) {
        if (process.config.variables.node_shared_openssl) {
            console.error(
                "Could not enable FIPS mode. Please ensure that your system OpenSSL installation supports FIPS."
            );
        } else {
            console.error("Could not enable FIPS mode. This installation does not appear to support FIPS.");
        }
        console.error("Error details:");
        console.error(fipsError);
        process.exit(1);
    }
}

enableFipsIfRequested();

import crypto from "crypto";
import { Keychain, CompositeLogger } from "@mongodb-js/mcp-core";
import { ConsoleLogger, DiskLogger, LogId } from "@mongodb-js/mcp-logging";
import { MongoLogManager } from "mongodb-log-writer";
import * as fs from "fs/promises";
import { parseUserConfig } from "./common/config/parseUserConfig.js";
import { type UserConfig } from "./common/config/userConfig.js";
import { packageInfo } from "./common/packageInfo.js";
import { StdioRunner, StreamableHttpRunner, MCPHttpServer, MonitoringServer } from "@mongodb-js/mcp-http-transports";
import { SessionStore } from "@mongodb-js/mcp-core";
import { DryRunModeRunner } from "./transports/dryModeRunner.js";
import type { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { systemCA } from "@mongodb-js/devtools-proxy-support";
import { runSetup } from "./setup/setupMcpServer.js";
import { PrometheusMetrics, createDefaultMetrics, type DefaultMetrics } from "@mongodb-js/mcp-metrics";
import type { IMetrics, MetricDefinitions, DefaultMetricDefinitions } from "@mongodb-js/mcp-types";
import { Server } from "./server.js";
import { Session } from "./common/session.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SetupTelemetry } from "./setup/setupTelemetry.js";
import { Elicitation } from "./elicitation.js";
import { connectionErrorHandler } from "./common/connectionErrorHandler.js";
import { MCPConnectionManager, ExportsManager } from "@mongodb-js/mcp-tools-mongodb";
import { createAtlasLocalClient } from "@mongodb-js/mcp-tools-atlas-local";
import { ApiClient } from "@mongodb-js/mcp-atlas-api-client";
import { Keychain as CoreKeychain } from "@mongodb-js/mcp-core";
import type { AtlasTelemetry } from "@mongodb-js/mcp-atlas-telemetry";
import type { DeviceId } from "@mongodb-js/mcp-tools-mongodb";
import type { HttpServerConfig, SessionManagementConfig } from "@mongodb-js/mcp-types";

/**
 * Concrete MCPHttpServer implementation that creates Server instances for each session.
 */
class MongoDBMCPHttpServer extends MCPHttpServer<Server> {
    private userConfig: UserConfig;
    private baseLogger: CompositeLogger;

    constructor({
        userConfig,
        httpOptions,
        sessionOptions,
        logger,
        metrics,
        sessionStore,
    }: {
        userConfig: UserConfig;
        httpOptions: HttpServerConfig;
        sessionOptions: SessionManagementConfig;
        logger: CompositeLogger;
        metrics: IMetrics<DefaultMetricDefinitions>;
        sessionStore: SessionStore<StreamableHTTPServerTransport>;
    }) {
        super({ httpOptions, sessionOptions, logger, metrics, sessionStore });
        this.userConfig = userConfig;
        this.baseLogger = logger;
    }

    protected override async createServer(): Promise<Server> {
        return createServerForConfig({
            config: this.userConfig,
            logger: this.baseLogger,
            metrics: this.metrics as PrometheusMetrics<DefaultMetrics>,
        });
    }
}

async function main(): Promise<void> {
    systemCA().catch(() => undefined); // load system CA asynchronously as in mongosh

    const args = process.argv.slice(2);
    const isSetupRequested = args[0] === "setup";
    if (isSetupRequested) {
        // remove the "setup" argument so it doesn't interfere with arg parsings
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
        handleVersionRequest();
    }

    if (isSetupRequested) {
        await runSetup(config);
    }

    if (config.dryRun) {
        await handleDryRunRequest(config);
    }

    const loggers = await createDefaultLoggers(config);
    const metrics = new PrometheusMetrics({ definitions: createDefaultMetrics() });

    let transportRunner: StdioRunner<Server> | StreamableHttpRunner<Server>;

    // Ensure we have at least one logger (wrapped in CompositeLogger)
    const baseLogger = loggers[0] ?? new CompositeLogger({ loggers: [new ConsoleLogger({ keychain: Keychain.root })] });

    if (config.transport === "stdio") {
        transportRunner = new StdioRunner({
            loggers,
            metrics: metrics as IMetrics<MetricDefinitions>,
            createServer: async (): Promise<Server> => {
                return createServerForConfig({ config, logger: baseLogger, metrics });
            },
        });
    } else {
        const sessionStore = new SessionStore<StreamableHTTPServerTransport>({
            options: {
                idleTimeoutMS: 3600000,
                notificationTimeoutMS: 3000000,
            },
            logger: baseLogger,
            metrics: metrics as IMetrics<DefaultMetricDefinitions>,
        });

        const compositeLogger = new CompositeLogger({ loggers });

        const mcpHttpServer = new MongoDBMCPHttpServer({
            userConfig: config,
            httpOptions: {
                host: config.httpHost,
                port: config.httpPort,
                responseType: config.httpResponseType,
                headers: config.httpHeaders as Record<string, string> | undefined,
            },
            sessionOptions: {
                externallyManagedSessions: config.externallyManagedSessions,
                idleTimeoutMs: 3600000,
                notificationTimeoutMs: 3000000,
            },
            logger: compositeLogger,
            metrics: metrics as IMetrics<DefaultMetricDefinitions>,
            sessionStore,
        });

        let monitoringServer: MonitoringServer | undefined;
        if (config.monitoringServerHost && config.monitoringServerPort) {
            monitoringServer = new MonitoringServer({
                host: config.monitoringServerHost,
                port: config.monitoringServerPort,
                features: config.monitoringServerFeatures,
                logger: loggers[0] ?? new ConsoleLogger({ keychain: Keychain.root }),
                metrics: metrics as IMetrics<DefaultMetricDefinitions>,
            });
        }

        transportRunner = new StreamableHttpRunner({
            loggers,
            metrics: metrics as IMetrics<MetricDefinitions>,
            mcpHttpServer,
            monitoringServer,
            sessionStore,
        });
    }

    const shutdown = (): void => {
        transportRunner.logger.info({
            id: LogId.serverCloseRequested,
            context: "server",
            message: `Server close requested`,
        });

        transportRunner
            .close()
            .then(() => {
                transportRunner.logger.info({
                    id: LogId.serverClosed,
                    context: "server",
                    message: `Server closed`,
                });
                process.exit(0);
            })
            .catch((error: unknown) => {
                transportRunner.logger.error({
                    id: LogId.serverCloseFailure,
                    context: "server",
                    message: `Error closing server: ${error as string}`,
                });
                process.exit(1);
            });
    };

    process.on("SIGINT", shutdown);
    process.on("SIGABRT", shutdown);
    process.on("SIGTERM", shutdown);
    process.on("SIGQUIT", shutdown);

    try {
        await transportRunner.start();
    } catch (error: unknown) {
        transportRunner.logger.info({
            id: LogId.serverCloseRequested,
            context: "server",
            message: `Closing server due to error: ${error as string}`,
        });

        try {
            await transportRunner.close();
            transportRunner.logger.info({
                id: LogId.serverClosed,
                context: "server",
                message: "Server closed",
            });
        } catch (error: unknown) {
            transportRunner.logger.error({
                id: LogId.serverCloseFailure,
                context: "server",
                message: `Error closing server: ${error as string}`,
            });
        }
        throw error;
    }
}

main().catch((error: unknown) => {
    // At this point, we may be in a very broken state, so we can't rely on the logger
    // being functional. Instead, create a brand new ConsoleLogger and log the error
    // to the console.
    const logger = new ConsoleLogger({ keychain: Keychain.root });
    logger.emergency({
        id: LogId.serverStartFailure,
        context: "server",
        message: `Fatal error running server: ${error as string}`,
    });
    process.exit(1);
});

function handleHelpRequest(): never {
    console.log("For usage information refer to the README.md:");
    console.log("https://github.com/mongodb-js/mongodb-mcp-server?tab=readme-ov-file#quick-start");
    process.exit(0);
}

function handleVersionRequest(): never {
    console.log(packageInfo.version);
    process.exit(0);
}

export async function handleDryRunRequest(config: UserConfig): Promise<never> {
    try {
        const metrics = new PrometheusMetrics({ definitions: createDefaultMetrics() });
        const consoleLogger = new ConsoleLogger({ keychain: Keychain.root });
        const compositeLogger = new CompositeLogger({ loggers: [consoleLogger] });

        // Create the server instance
        const server = await createServerForConfig({ config, logger: compositeLogger, metrics });

        const runner = new DryRunModeRunner({
            logger: {
                log: console.log,
                error: console.error,
            },
            userConfig: config,
            server,
            metrics: metrics as IMetrics<DefaultMetricDefinitions>,
        });
        await runner.start();
        await runner.stop();
        process.exit(0);
    } catch (error) {
        console.error(`Fatal error running server in dry run mode: ${error as string}`);
        process.exit(1);
    }
}

async function createDefaultLoggers(config: UserConfig): Promise<CompositeLogger[]> {
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
    return [new CompositeLogger({ loggers: baseLoggers })];
}

type CreateServerOptions = {
    config: UserConfig;
    logger: CompositeLogger;
    metrics: PrometheusMetrics<DefaultMetrics>;
};

async function createServerForConfig({ config, logger, metrics }: CreateServerOptions): Promise<Server> {
    const keychain = CoreKeychain.root;

    // Create exports manager using the static init method
    const exportsManager = ExportsManager.init({
        options: {
            exportsPath: config.exportsPath,
            exportTimeoutMs: config.exportTimeoutMs,
            exportCleanupIntervalMs: config.exportCleanupIntervalMs,
        },
        logger,
    });

    const connectionManager = new MCPConnectionManager({
        logger,
        deviceId: {} as DeviceId,
        options: {
            connectionInfo: { transport: "http", httpHost: "localhost" },
            displayName: "mongodb-mcp-server",
            version: packageInfo.version,
        },
    });

    let apiClient: ApiClient | undefined;
    // Check if credentials are available (apiClientId/apiClientSecret for API auth)
    const clientId = config.apiClientId;
    const clientSecret = config.apiClientSecret;
    if (clientId && clientSecret) {
        apiClient = new ApiClient({
            baseUrl: config.apiBaseUrl,
            userAgent: `mongodb-mcp-server/${packageInfo.version}`,
            logger,
            credentials: {
                clientId,
                clientSecret,
            },
        });
    }

    const atlasLocalClient = await createAtlasLocalClient({
        logger,
    });

    // Create setup telemetry using the static create method and cast to AtlasTelemetry
    const setupTelemetry = SetupTelemetry.create(
        { apiBaseUrl: config.apiBaseUrl, telemetry: config.telemetry },
        keychain
    );
    const telemetry = setupTelemetry as unknown as AtlasTelemetry;

    const mcpServer = new McpServer({
        name: "mongodb-mcp-server",
        version: packageInfo.version,
    });

    const elicitation = new Elicitation({ server: mcpServer.server });

    if (!apiClient) {
        throw new Error("API client is required but not available. Please provide clientId and clientSecret.");
    }

    const session = new Session({
        userConfig: config,
        logger,
        exportsManager,
        connectionManager,
        keychain,
        apiClient,
        connectionErrorHandler,
        atlasLocalClient,
    });

    const server = new Server({
        session,
        userConfig: config,
        mcpServer,
        telemetry,
        connectionErrorHandler,
        elicitation,
        metrics,
    });

    return server;
}
