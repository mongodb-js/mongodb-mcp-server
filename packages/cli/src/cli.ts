#!/usr/bin/env node
/* eslint-disable no-console */

import { StdioRunner } from "@mongodb-js/mcp-core";
import { LogId } from "@mongodb-js/mcp-core";
import { SessionStore } from "@mongodb-js/mcp-core";
import { StreamableHttpRunner, MonitoringServer } from "@mongodb-js/mcp-http-runners";
import type { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { systemCA } from "@mongodb-js/devtools-proxy-support";
import {
    PrometheusMetrics,
    createDefaultMetrics,
    type DefaultPrometheusMetricDefinitions,
} from "@mongodb-js/mcp-metrics";
import type { IMetrics, DefaultMetricDefinitions } from "@mongodb-js/mcp-types";
import type { CompositeLogger } from "@mongodb-js/mcp-core";

import { parseUserConfig } from "./config/parseUserConfig.js";
import type { UserConfig } from "./config/userConfig.js";

import {
    type CliHandler,
    HelpHandler,
    VersionHandler,
    DryRunHandler,
    SetupHandler,
    type ServerCreator,
    type SetupFunction,
} from "./handlers/index.js";

import { MCPHttpServerWrapper } from "./server/index.js";
import { createDefaultLoggers } from "./utils/index.js";

export type CLIOptions = {
    packageInfo: { version: string; mcpServerName: string };
    createServer: ServerCreator;
    setupFunction?: SetupFunction;
    enableFipsIfRequested?(): void;
    handlers?: CliHandler[];
};

export async function setupMcpCli(options: CLIOptions): Promise<void> {
    const { packageInfo, createServer, setupFunction, enableFipsIfRequested } = options;

    if (enableFipsIfRequested) {
        enableFipsIfRequested();
    }

    systemCA().catch(() => undefined);

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

    // Create default handlers
    const handlers: CliHandler[] = options.handlers || [
        new HelpHandler(),
        new VersionHandler(packageInfo.version),
        ...(setupFunction ? [new SetupHandler(setupFunction)] : []),
        new DryRunHandler(createServer),
    ];

    // Check if any handler should handle this request
    for (const handler of handlers) {
        if (handler.shouldHandle(config, args)) {
            await handler.handle(config);
            return;
        }
    }

    // Start the server normally
    await startServer(config, createServer);
}

async function startServer(
    config: UserConfig,
    createServer: ServerCreator
): Promise<void> {
    const logger = await createDefaultLoggers(config);
    const metrics = new PrometheusMetrics({ definitions: createDefaultMetrics() });

    let transportRunner: any;

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
            createServer,
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

// Re-export handler types and classes
export {
    type CliHandler,
    HelpHandler,
    VersionHandler,
    DryRunHandler,
    SetupHandler,
    type ServerCreator,
    type SetupFunction,
    handleHelpRequest,
    handleVersionRequest,
    handleDryRun,
} from "./handlers/index.js";

// Re-export server wrapper
export { MCPHttpServerWrapper } from "./server/index.js";

// Re-export utilities
export { createDefaultLoggers } from "./utils/index.js";

// Re-export config
export { parseUserConfig, type UserConfig } from "./config/parseUserConfig.js";
export { UserConfigSchema, configRegistry, ALL_CONFIG_KEYS } from "./config/userConfig.js";

// Re-export other utilities
export {
    commaSeparatedToArray,
    parseBoolean,
    oneWayOverride,
    onlyLowerThanBaseValueOverride,
    onlyStricterLogLevelOverride,
    onlySubsetOfBaseValueOverride,
    getLocalDataPath,
    getLogPath,
    getExportsPath,
    type CustomOverrideLogic,
    type OverrideBehavior,
    type ConfigFieldMeta,
} from "./config/configUtils.js";

export { TRANSPORT_PAYLOAD_LIMITS, type TransportType } from "./transports/constants.js";
export {
    DryRunModeRunner,
    type DryRunServer,
    type DryRunLogger,
    type DryRunModeRunnerOptions,
} from "./transports/dryModeRunner.js";
