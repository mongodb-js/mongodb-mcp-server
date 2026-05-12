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
    public readonly httpOptions: HttpServerOptions;

    constructor({ options, logger }: { options: ExpressBasedHttpServerOptions; logger: ILogger }) {
        this.app = express();
        this.app.enable("trust proxy"); // needed for reverse proxy support
        this.httpOptions = options.http;
        this.logger = logger;
        this.logContext = options.logContext;
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
