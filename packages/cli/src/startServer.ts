import { StdioRunner, SessionStore, LogId } from "@mongodb-js/mcp-core";
import { StreamableHttpRunner, MonitoringServer } from "@mongodb-js/mcp-http-runners";
import type { SessionServer } from "@mongodb-js/mcp-types";
import type { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { IMetrics, DefaultMetricDefinitions } from "@mongodb-js/mcp-types";
import type { CompositeLogger } from "@mongodb-js/mcp-core";
import type { UserConfig } from "./config/userConfig.js";
import { MCPHttpServerWrapper } from "./cliServer/mcpHttpServerWrapper.js";

export async function startServer(
    server: SessionServer,
    config: UserConfig,
    logger: CompositeLogger,
    metrics: IMetrics<DefaultMetricDefinitions>,
    onExit: (errorCode: number) => void
): Promise<void> {
    let transportRunner: StdioRunner | StreamableHttpRunner;

    if (config.transport === "stdio") {
        transportRunner = new StdioRunner({
            logger,
            server,
        });
    } else {
        const sessionStore = new SessionStore<StreamableHTTPServerTransport>({
            options: {
                idleTimeoutMS: 3600000,
                notificationTimeoutMS: 3000000,
            },
            logger,
            metrics,
        });

        const mcpHttpServer = new MCPHttpServerWrapper({
            server,
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
            metrics,
            sessionStore,
        });

        let monitoringServer: MonitoringServer | undefined;
        if (config.monitoringServerHost && config.monitoringServerPort) {
            monitoringServer = new MonitoringServer({
                options: {
                    http: {
                        host: config.monitoringServerHost,
                        port: config.monitoringServerPort,
                    },
                    features: config.monitoringServerFeatures,
                },
                logger,
                metrics,
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
            onExit(1);
        } finally {
            logger.info({
                id: LogId.serverClosed,
                context: "server",
                message: `Server closed`,
            });
            await logger.flush();
            onExit(0);
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
