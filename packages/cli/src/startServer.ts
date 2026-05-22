import { StdioRunner, SessionStore, LogId } from "@mongodb-js/mcp-core";
import { StreamableHttpRunner } from "@mongodb-js/mcp-http-runners";
import type { MonitoringServer } from "@mongodb-js/mcp-http-runners";
import type { SessionServer } from "@mongodb-js/mcp-types";
import type { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { IMetrics, DefaultMetricDefinitions } from "@mongodb-js/mcp-types";
import type { CompositeLogger } from "@mongodb-js/mcp-core";
import type { UserConfig } from "./config/userConfig.js";
import type { OnExit } from "./types.js";
import { SharedSessionMCPHttpServer } from "./cliServer/sharedSessionMCPHttpServer.js";

export type StartServerOptions = {
    server: SessionServer;
    config: UserConfig;
    logger: CompositeLogger;
    metrics: IMetrics<DefaultMetricDefinitions>;
    monitoringServer?: MonitoringServer;
    onExit: OnExit;
};

export async function startServer({
    server,
    config,
    logger,
    metrics,
    monitoringServer,
    onExit,
}: StartServerOptions): Promise<void> {
    let transportRunner: StdioRunner | StreamableHttpRunner;

    if (config.transport === "stdio") {
        transportRunner = new StdioRunner({
            logger,
            server,
        });
    } else {
        const sessionStore = new SessionStore<StreamableHTTPServerTransport>({
            options: {
                idleTimeoutMS: config.idleTimeoutMs,
                notificationTimeoutMS: config.notificationTimeoutMs,
            },
            logger,
            metrics,
        });

        const mcpHttpServer = new SharedSessionMCPHttpServer({
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
                    idleTimeoutMs: config.idleTimeoutMs,
                    notificationTimeoutMs: config.notificationTimeoutMs,
                },
            },
            logger,
            metrics,
            sessionStore,
        });

        transportRunner = new StreamableHttpRunner({
            logger,
            mcpHttpServer,
            monitoringServer,
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
