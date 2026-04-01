import express from "express";
import type http from "http";
import type { LoggerBase } from "./types.js";

type ExpressConfig = {
    port: number;
    hostname: string;
};

export abstract class ExpressBasedHttpServer {
    protected httpServer: http.Server | undefined;
    protected app: express.Express;

    protected readonly logger: LoggerBase;
    protected readonly logContext: string;

    protected readonly expressConfig: ExpressConfig;

    constructor(config: { logger: LoggerBase; logContext: string } & ExpressConfig) {
        this.app = express();
        this.app.enable("trust proxy"); // needed for reverse proxy support
        this.expressConfig = { port: config.port, hostname: config.hostname };

        this.logger = config.logger;
        this.logContext = config.logContext;
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
        // If already started, no-op
        if (this.httpServer) {
            return;
        }

        await this.setupRoutes();

        const { port, hostname } = this.expressConfig;

        this.httpServer = await new Promise<http.Server>((resolve, reject) => {
            const result = this.app.listen(port, hostname, (err?: Error) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(result);
                }
            });
        });

        this.logger.info({
            id: "httpServerStarted",
            context: "server",
            message: `Http server started on address: ${this.serverAddress}`,
        });
    }

    public async stop(): Promise<void> {
        if (this.httpServer) {
            this.logger.info({
                id: "httpServerStopping",
                context: "server",
                message: "Stopping server...",
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

            this.httpServer = undefined;

            this.logger.info({
                id: "httpServerStopped",
                context: "server",
                message: "Server stopped",
            });
        } else {
            this.logger.info({
                id: "httpServerNotRunning",
                context: "server",
                message: "Server is not running",
            });
        }
    }
}
