import { MCPHttpServer } from "@mongodb-js/mcp-http-runners";
import type { SessionStore } from "@mongodb-js/mcp-core";
import type { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { HttpServerOptions, SessionManagementOptions } from "@mongodb-js/mcp-types";
import type { CompositeLogger } from "@mongodb-js/mcp-core";
import type { IMetrics, DefaultMetricDefinitions } from "@mongodb-js/mcp-types";
import type { UserConfig } from "../config/userConfig.js";
import type { ServerFactory } from "../handlers/dryRunHandler.js";

type ServerType = {
    connect(transport: any): Promise<void>;
    close(): Promise<void>;
};

export class MCPHttpServerWrapper extends MCPHttpServer<ServerType> {
    private userConfig: UserConfig;
    private baseLogger: CompositeLogger;
    private serverFactory: ServerFactory<ServerType>;

    constructor({
        userConfig,
        serverFactory,
        options,
        logger,
        metrics,
        sessionStore,
    }: {
        userConfig: UserConfig;
        serverFactory: ServerFactory<ServerType>;
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
        this.serverFactory = serverFactory;
    }

    protected override async createServerForRequest(): Promise<ServerType> {
        return this.serverFactory({
            config: this.userConfig,
            logger: this.baseLogger,
            metrics: this.metrics,
        });
    }
}
