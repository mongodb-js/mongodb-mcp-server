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
import { LogId, ConsoleLogger } from "./common/logging/index.js";
import { parseUserConfig } from "./common/config/parseUserConfig.js";
import { type UserConfig } from "./common/config/userConfig.js";
import { packageInfo } from "./common/packageInfo.js";
import { StdioRunner, StreamableHttpRunner, DryRunModeRunner, MCPHttpServer } from "@mongodb-mcp/transport";
import type { MCPServer, RequestContext } from "@mongodb-mcp/transport";
import { systemCA } from "@mongodb-js/devtools-proxy-support";
import { Keychain } from "./common/keychain.js";
import { runSetup } from "./setup/setupMcpServer.js";
import { DeviceId } from "./helpers/deviceId.js";
import { PrometheusMetrics, createDefaultMetrics } from "@mongodb-mcp/monitoring";
import type { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
    createLoggerFromConfig,
    createMonitoringServerFromConfig,
    createSessionStoreFromConfig,
} from "./transports/createFromConfig.js";
import { createMCPServer } from "./transports/createMCPServer.js";

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
        await handleSetupRequest(config);
    }

    if (config.dryRun) {
        await handleDryRunRequest(config);
    }

    // Build all dependencies at the composition root
    const logger = createLoggerFromConfig(config);
    const deviceId = DeviceId.create(logger);
    const metrics = new PrometheusMetrics({ definitions: createDefaultMetrics() });

    const transportRunner =
        config.transport === "stdio"
            ? new StdioRunner({
                  logger,
                  deviceId,
                  metrics,
                  server: await createMCPServer({ config, logger, metrics }),
              })
            : new StreamableHttpRunner({
                  logger,
                  deviceId,
                  metrics,
                  mcpHttpServer: new MCPHttpServer({
                      createServerForRequest: ({ request }: { request: RequestContext }): Promise<MCPServer> =>
                          createMCPServer({ config, logger, metrics, request }),
                      httpConfig: {
                          httpPort: config.httpPort,
                          httpHost: config.httpHost,
                          httpBodyLimit: config.httpBodyLimit,
                          httpHeaders: config.httpHeaders,
                          httpResponseType: config.httpResponseType,
                          externallyManagedSessions: config.externallyManagedSessions,
                      },
                      logger,
                      metrics,
                      sessionStore: createSessionStoreFromConfig<StreamableHTTPServerTransport>(
                          config,
                          logger,
                          metrics
                      ),
                  }),
                  monitoringServer: createMonitoringServerFromConfig(config, logger, metrics),
              });
    const shutdown = (): void => {
        logger.info({
            id: LogId.serverCloseRequested,
            context: "server",
            message: `Server close requested`,
        });

        transportRunner
            .close()
            .then(() => {
                logger.info({
                    id: LogId.serverClosed,
                    context: "server",
                    message: `Server closed`,
                });
                process.exit(0);
            })
            .catch((error: unknown) => {
                logger.error({
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
        } catch (closeError: unknown) {
            logger.error({
                id: LogId.serverCloseFailure,
                context: "server",
                message: `Error closing server: ${closeError as string}`,
            });
        }
        throw error;
    }
}

main().catch((error: unknown) => {
    const logger = new ConsoleLogger(Keychain.root);
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

async function handleSetupRequest(config: UserConfig): Promise<never> {
    await runSetup(config);
    process.exit(0);
}

export async function handleDryRunRequest(config: UserConfig): Promise<never> {
    try {
        const logger = createLoggerFromConfig(config);
        const deviceId = DeviceId.create(logger);
        const metrics = new PrometheusMetrics({ definitions: createDefaultMetrics() });

        const runner = new DryRunModeRunner({
            logger,
            deviceId,
            metrics,
            configForDisplay: config,
            output: {
                log(message): void {
                    console.log(message);
                },
                error(message): void {
                    console.error(message);
                },
            },
        });
        await runner.start();
        await runner.close();
        process.exit(0);
    } catch (error) {
        console.error(`Fatal error running server in dry run mode: ${error as string}`);
        process.exit(1);
    }
}
