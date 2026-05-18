import { MCPHttpServer } from "@mongodb-js/mcp-http-runners";
import type { SessionStore } from "@mongodb-js/mcp-core";
import type { HttpServerOptions, SessionManagementOptions } from "@mongodb-js/mcp-types";
import type { CompositeLogger } from "@mongodb-js/mcp-core";
import type { IMetrics, DefaultMetricDefinitions } from "@mongodb-js/mcp-types";
import type { UserConfig } from "../config/userConfig.js";
import type { ServerCreator } from "../handlers/dryRunHandler.js";

type ServerType = {
    connect(transport: any): Promise<void>;
    close(): Promise<void>;
};

export class MCPHttpServerWrapper extends MCPHttpServer<ServerType> {
    private userConfig: UserConfig;
    private baseLogger: CompositeLogger;
    private createServer: ServerCreator;

    constructor({
        userConfig,
        createServer,
        options,
        logger,
        metrics,
        sessionStore,
    }: {
        userConfig: UserConfig;
        createServer: ServerCreator;
        options: {
            http: HttpServerOptions;
            session: SessionManagementOptions;
        };
        logger: CompositeLogger;
        metrics: IMetrics<DefaultMetricDefinitions>;
        sessionStore: SessionStore<any>;
    }) {
        super({ options, logger, metrics, sessionStore });
        this.userConfig = userConfig;
        this.baseLogger = logger;
        this.createServer = createServer;
    }

    protected override async createServerForRequest(): Promise<ServerType> {
        return this.createServer({
            config: this.userConfig,
            logger: this.baseLogger,
            metrics: this.metrics,
        });
    }
}
