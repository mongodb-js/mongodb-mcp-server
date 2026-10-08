import express from "express";
import type http from "http";
import type { ILogger, HttpServerOptions } from "@mongodb-js/mcp-types";
import { LogId } from "@mongodb-js/mcp-core";

export type ExpressBasedHttpServerOptions = {
    logContext: string;
    http: HttpServerOptions;
};

/**
 * Base class for Express-based HTTP servers.
 * Provides common functionality for starting and stopping HTTP servers.
 */
export abstract class ExpressBasedHttpServer {
    protected httpServer: http.Server | undefined;
    protected app: express.Express;

    protected readonly logger: ILogger;
    protected readonly logContext: string;
    protected readonly httpOptions: HttpServerOptions;

    constructor({ options, logger }: { options: ExpressBasedHttpServerOptions; logger: ILogger }) {
        this.app = express();
        this.app.enable("trust proxy"); // needed for reverse proxy support
        this.httpOptions = options.http;
        this.logger = logger;
        this.logContext = options.logContext;
    }

    private checkHttpHost(): void {
        const host = this.httpOptions.host;
        const trimmed = host.trim();
        // Loopback only. Everything else (0.0.0.0, ::, a LAN IP, a hostname, or
        // an empty string meaning "listen on all interfaces") exposes the server
        // to the network and is treated as dangerous.
        const safeHosts = new Set(["127.0.0.1", "localhost", "::1"]);
        const isDangerous = !safeHosts.has(trimmed);
        if (!isDangerous) {
            return;
        }

        const displayHost = host === "" ? "<all interfaces>" : host;
        if (this.httpOptions.dangerousHostBinding !== true) {
            throw new Error(
                `Refusing to bind the ${this.logContext} server to non-loopback host "${displayHost}". ` +
                    `Binding to this host exposes the server to the entire network and can allow unauthorized access to your database context. ` +
                    `If you are intentionally exposing this server, pass --dangerousHostBinding or set the MDB_MCP_DANGEROUS_HOST_BINDING environment variable.`
            );
        }

        this.logger.warning({
            id: LogId.streamableHttpTransportHttpHostWarning,
            context: this.logContext,
            message: `Binding to ${displayHost} can expose the MCP Server to the entire local network, which allows other devices on the same network to potentially access the MCP Server. This is a security risk and could allow unauthorized access to your database context.`,
            noRedaction: true,
        });
    }

    public get serverAddress(): string {
        const result = this.httpServer?.address();
        if (typeof result === "string") {
            return result;
        }
        if (typeof result === "object" && result) {
            return `http://${result.address}:${result.port}`;
        }
        throw new Error("Server is not started yet");
    }

    protected abstract setupRoutes(): Promise<void>;

    public async start(): Promise<void> {
        this.checkHttpHost();

        await this.setupRoutes();

        const { port, host } = this.httpOptions;

        this.httpServer = await new Promise<http.Server>((resolve, reject) => {
            const result = this.app.listen(port, host, (err?: Error) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(result);
                }
            });
        });

        this.logger.info({
            message: `Http server started on address: ${this.serverAddress}`,
            context: this.logContext,
            noRedaction: true,
            id: LogId.httpServerStarted,
        });
    }

    public async stop(): Promise<void> {
        if (this.httpServer) {
            this.logger.info({
                message: "Stopping server...",
                context: this.logContext,
                id: LogId.httpServerStopping,
            });

            const server = this.httpServer;

            await new Promise((resolve, reject) => {
                server.close((err?: Error) => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve(undefined);
                    }
                });
            });
            this.logger.info({
                message: "Server stopped",
                context: this.logContext,
                id: LogId.httpServerStopped,
            });
        } else {
            this.logger.info({
                message: "Server is not running",
                context: this.logContext,
                id: LogId.httpServerStopped,
            });
        }
    }
}
