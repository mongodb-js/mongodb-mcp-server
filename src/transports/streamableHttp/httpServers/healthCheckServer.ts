import type express from "express";
import { ExpressBasedHttpServer } from "./expressBasedHttpServer.js";
import { type LoggerBase } from "../../../common/logging/index.js";

export class HealthCheckServer extends ExpressBasedHttpServer {
    constructor(healthCheckHost: string, healthCheckPort: number, logger: LoggerBase) {
        super({
            port: healthCheckPort,
            hostname: healthCheckHost,
            logger,
            logContext: "healthCheckServer",
        });
    }

    protected override setupRoutes(): Promise<void> {
        this.app.get("/health", (_req: express.Request, res: express.Response) => {
            res.json({
                status: "ok",
            });
        });

        return Promise.resolve();
    }
}
