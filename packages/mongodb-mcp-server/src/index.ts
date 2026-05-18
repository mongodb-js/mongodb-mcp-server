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
import { Keychain, CompositeLogger, StdioRunner } from "@mongodb-js/mcp-core";
import { ConsoleLogger, DiskLogger } from "@mongodb-js/mcp-logging";
import { LogId } from "@mongodb-js/mcp-core";
import { MongoLogManager } from "mongodb-log-writer";
import * as fs from "fs/promises";
import { parseUserConfig } from "./common/config/parseUserConfig.js";
import { type UserConfig } from "./common/config/userConfig.js";
import { packageInfo } from "./common/packageInfo.js";
import { SessionStore } from "@mongodb-js/mcp-core";
import { StreamableHttpRunner, MCPHttpServer, MonitoringServer } from "@mongodb-js/mcp-http-runners";
import { DryRunModeRunner } from "./transports/dryModeRunner.js";
import type { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { systemCA } from "@mongodb-js/devtools-proxy-support";
import { runSetup } from "./setup/setupMcpServer.js";
import {
    PrometheusMetrics,
    createDefaultMetrics,
    type DefaultPrometheusMetricDefinitions,
} from "@mongodb-js/mcp-metrics";
import type { IMetrics, DefaultMetricDefinitions } from "@mongodb-js/mcp-types";
import { Server } from "./server.js";
import { Session } from "./common/session.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { Elicitation } from "@mongodb-js/mcp-core";
import { connectionErrorHandler } from "./common/connectionErrorHandler.js";
import { MCPConnectionManager, ExportsManager } from "@mongodb-js/mcp-tools-mongodb";
import { createAtlasLocalClient } from "@mongodb-js/mcp-tools-atlas-local";
import { ApiClient } from "@mongodb-js/mcp-atlas-api-client";
import { Keychain as CoreKeychain } from "@mongodb-js/mcp-core";
import { AtlasTelemetry, buildMachineMetadata } from "@mongodb-js/mcp-atlas-telemetry";
import { DeviceId } from "@mongodb-js/mcp-tools-mongodb";
import type { HttpServerOptions, SessionManagementOptions } from "@mongodb-js/mcp-types";

/**
 * Concrete MCPHttpServer implementation that creates Server instances for each session.
 */
class MongoDBMCPHttpServer extends MCPHttpServer<Server> {
    private userConfig: UserConfig;
    private baseLogger: CompositeLogger;

    constructor({
        userConfig,
        options,
        logger,
        metrics,
        sessionStore,
    }: {
        userConfig: UserConfig;
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
    }

    protected override async createServerForRequest(): Promise<Server> {
        return createServerForConfig({
            config: this.userConfig,
            logger: this.baseLogger,
            metrics: this.metrics,
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

    const logger = await createDefaultLoggers(config);
    const metrics = new PrometheusMetrics({ definitions: createDefaultMetrics() });

    let transportRunner: StdioRunner<Server> | StreamableHttpRunner<Server>;

    if (config.transport === "stdio") {
        const server = await createServerForConfig({
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

        const mcpHttpServer = new MongoDBMCPHttpServer({
            userConfig: config,
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
        });
        await runner.start();
        await runner.stop();
        process.exit(0);
    } catch (error) {
        console.error(`Fatal error running server in dry run mode: ${error as string}`);
        process.exit(1);
    }
}

async function createDefaultLoggers(config: UserConfig): Promise<CompositeLogger> {
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

type CreateServerOptions = {
    config: UserConfig;
    logger: CompositeLogger;
    metrics: IMetrics<DefaultMetricDefinitions>;
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

    const deviceId = DeviceId.create(logger);

    const connectionManager = new MCPConnectionManager({
        logger,
        deviceId,
        options: {
            connectionInfo: { transport: "http", httpHost: "localhost" },
            displayName: "mongodb-mcp-server",
            version: packageInfo.version,
        },
    });

    const apiClient = new ApiClient({
        baseUrl: config.apiBaseUrl,
        userAgent: `mongodb-mcp-server/${packageInfo.version}`,
        logger,
        credentials: {
            clientId: config.apiClientId,
            clientSecret: config.apiClientSecret,
        },
    });

    const atlasLocalClient = await createAtlasLocalClient({
        logger,
    });
    const telemetry = AtlasTelemetry.create({
        logger,
        deviceId,
        apiClient,
        keychain,
        enabled: config.telemetry === "enabled",
        machineMetadata: buildMachineMetadata(packageInfo.mcpServerName, packageInfo.version),
    });

    const mcpServer = new McpServer({
        name: "mongodb-mcp-server",
        version: packageInfo.version,
    });

    const elicitation = new Elicitation({ server: mcpServer.server });

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
