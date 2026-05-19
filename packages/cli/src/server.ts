import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { LogLevel } from "@mongodb-js/mcp-core";
import { MCP_LOG_LEVELS, LogId } from "@mongodb-js/mcp-core";
import type { UserConfig } from "./config/userConfig.js";
import type { CallToolResult } from "@mongodb-js/mcp-types";
import {
    CallToolRequestSchema,
    SetLevelRequestSchema,
    SubscribeRequestSchema,
    UnsubscribeRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { type ConnectionErrorHandler } from "@mongodb-js/mcp-tools-mongodb";
import type { Elicitation } from "@mongodb-js/mcp-core";
import type { IMetrics, DefaultMetricDefinitions } from "@mongodb-js/mcp-types";
import type { AnyToolBase, ToolCategory } from "@mongodb-js/mcp-core";

/** MongoDB read-tool count-phase maxTimeMS caps applied when registering MongoDB tools (binary-only). */
export type MongoDBToolsRuntimeConfig = {
    queryCountMaxTimeMsCap: number;
    aggregationCountMaxTimeMsCap: number;
};

/** Package information for the server. */
export type PackageInfo = {
    version: string;
    mcpServerName: string;
    engines: { node: string };
};

/** Generic logger interface. */
export type ServerLogger = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    debug: (log: any) => void;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    info: (log: any) => void;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    warning: (log: any) => void;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    error: (log: any) => void;
};

/** Generic telemetry interface. */
export type ServerTelemetry = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    emitEvents: (events: any[]) => void;
    close: () => Promise<void>;
};

/** Generic session interface that Server requires. */
export type ServerSession = {
    logger: ServerLogger;
    setMcpClient: (client: { name?: string; version?: string; title?: string } | undefined) => void;
    apiClient?: { validateAuthConfig: () => Promise<void> } | undefined;
    connectToConfiguredConnection: () => Promise<void>;
    close?: () => Promise<void>;
};

/** Generic tool constructor interface that Server expects. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface ToolConstructor {
    // Constructor signature
    new (params: any): {
        register: (server: any) => boolean;
        isEnabled: () => boolean;
    };
    // Static properties that must exist on the class
    toolName: string;
    category: string;
    operationType: string;
}

/** Tool constructor registry - array of tool classes that can be instantiated. */
export type ToolRegistry = ToolConstructor[];

/** Resource constructor registry. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ResourceRegistry = readonly (new (
    session: ServerSession,
    userConfig: UserConfig,
    telemetry: ServerTelemetry
) => { register: (server: any) => boolean })[];

export interface ServerOptions<
    TUserConfig extends UserConfig = UserConfig,
    TMetrics extends DefaultMetricDefinitions = DefaultMetricDefinitions,
> {
    session: ServerSession;
    userConfig: TUserConfig;
    mcpServer: McpServer;
    telemetry: ServerTelemetry;
    elicitation: Elicitation;
    /** @deprecated Will be removed in a future version. Use `SessionOptions.connectionErrorHandler` instead. */
    connectionErrorHandler: ConnectionErrorHandler;
    uiRegistry?: unknown;
    metrics: IMetrics<TMetrics>;
    /**
     * An optional list of tools constructors to be registered to the MongoDB
     * MCP Server.
     *
     * When not provided, MongoDB MCP Server will register all internal tools.
     * When specified, **only** the tools in this list will be registered.
     *
     * This allows you to:
     * - Register only custom tools (excluding all internal tools)
     * - Register a subset of internal tools alongside custom tools
     * - Register all internal tools plus custom tools
     *
     * To include internal tools, import them from `mongodb-mcp-server/tools`:
     *
     * ```typescript
     * import { AllTools, AggregateTool, FindTool } from "mongodb-mcp-server/tools";
     *
     * // Register all internal tools plus custom tools
     * tools: [...AllTools, MyCustomTool]
     *
     * // Register only specific MongoDB tools plus custom tools
     * tools: [AggregateTool, FindTool, MyCustomTool]
     *
     * // Register all internal tools of mongodb category
     * tools: [AllTools.filter((tool) => tool.category === "mongodb")]
     * ```
     *
     * Note: Ensure that each tool has unique names otherwise the server will
     * throw an error when initializing an MCP Client session. If you're using
     * only the internal tools, then you don't have to worry about it unless,
     * you've overridden the tool names.
     *
     * To ensure that you provide compliant tool implementations extend your
     * tool implementation using `ToolBase` class and ensure that they conform
     * to `ToolClass` type from `mongodb-mcp-server/tools`.
     */
    tools?: ToolRegistry;
    /** Array of resource constructors to register. */
    resources?: ResourceRegistry;
    /**
     * MongoDB read-tool count-phase maxTimeMS caps. Omit to use built-in defaults
     * from `@mongodb-js/mcp-tools-mongodb` (`QUERY_COUNT_MAX_TIME_MS_CAP` and `AGG_COUNT_MAX_TIME_MS_CAP`).
     */
    runtimeConfig?: MongoDBToolsRuntimeConfig;
    /** Package information for the server. */
    packageInfo: PackageInfo;
    /** Connection string validator function. */
    validateConnectionString?: (connectionString: string, allowEmpty: boolean) => void;
}

export class Server<
    TUserConfig extends UserConfig = UserConfig,
    TMetrics extends DefaultMetricDefinitions = DefaultMetricDefinitions,
> {
    public readonly session: ServerSession;
    public readonly mcpServer: McpServer;
    private readonly telemetry: ServerTelemetry;
    public readonly userConfig: TUserConfig;
    public readonly elicitation: Elicitation;
    private readonly toolConstructors: ToolRegistry;
    private readonly resourceConstructors: ResourceRegistry;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    public readonly tools: any[] = [];
    public readonly connectionErrorHandler: ConnectionErrorHandler;
    public readonly uiRegistry?: unknown;
    public readonly metrics: IMetrics<TMetrics>;
    public readonly packageInfo: PackageInfo;

    private readonly runtimeConfig: MongoDBToolsRuntimeConfig;

    private _mcpLogLevel: LogLevel;
    /** Lowest log level allowed to be sent to the MCP client. */
    private readonly mcpLogLevelFloor: LogLevel;

    public get mcpLogLevel(): LogLevel {
        return this._mcpLogLevel;
    }

    private readonly startTime: number;
    private readonly subscriptions = new Set<string>();

    constructor({
        session,
        mcpServer,
        userConfig,
        telemetry,
        connectionErrorHandler,
        elicitation,
        tools,
        resources,
        uiRegistry,
        metrics,
        runtimeConfig = {
            queryCountMaxTimeMsCap: 5000,
            aggregationCountMaxTimeMsCap: 5000,
        },
        packageInfo,
    }: ServerOptions<TUserConfig, TMetrics>) {
        this.startTime = Date.now();
        this.session = session;
        this.telemetry = telemetry;
        this.mcpServer = mcpServer;
        this.userConfig = userConfig;
        this.elicitation = elicitation;
        this.connectionErrorHandler = connectionErrorHandler;
        this.toolConstructors = tools ?? [];
        this.resourceConstructors = resources ?? [];
        this.uiRegistry = uiRegistry;
        this.metrics = metrics;
        this.runtimeConfig = runtimeConfig;
        this.packageInfo = packageInfo;

        this._mcpLogLevel = userConfig.mcpClientLogLevel;
        this.mcpLogLevelFloor = this._mcpLogLevel;
    }

    async connect(transport: Transport): Promise<void> {
        await this.validateConfig();
        // Register resources after the server is initialized so they can listen to events like
        // connection events.
        this.registerResources();
        this.mcpServer.server.registerCapabilities({
            logging: {},
            resources: { listChanged: true, subscribe: true },
        });

        // TODO: Eventually we might want to make tools reactive too instead of relying on custom logic.
        this.registerTools();

        // This is a workaround for an issue we've seen with some models, where they'll see that everything in the `arguments`
        // object is optional, and then not pass it at all. However, the MCP server expects the `arguments` object to be if
        // the tool accepts any arguments, even if they're all optional.
        //
        // see: https://github.com/modelcontextprotocol/typescript-sdk/blob/131776764536b5fdca642df51230a3746fb4ade0/src/server/mcp.ts#L705
        // Since paramsSchema here is not undefined, the server will create a non-optional z.object from it.
        const existingHandler = (
            this.mcpServer.server["_requestHandlers"] as Map<
                string,
                (request: unknown, extra: unknown) => Promise<CallToolResult>
            >
        ).get(CallToolRequestSchema.shape.method.value);

        if (!existingHandler) {
            throw new Error("No existing handler found for CallToolRequestSchema");
        }

        this.mcpServer.server.setRequestHandler(CallToolRequestSchema, (request, extra): Promise<CallToolResult> => {
            if (!request.params.arguments) {
                request.params.arguments = {};
            }

            return existingHandler(request, extra);
        });

        this.mcpServer.server.setRequestHandler(SubscribeRequestSchema, ({ params }) => {
            this.subscriptions.add(params.uri);
            this.session.logger.debug({
                id: LogId.serverInitialized,
                context: "resources",
                message: `Client subscribed to resource: ${params.uri}`,
            });
            return {};
        });

        this.mcpServer.server.setRequestHandler(UnsubscribeRequestSchema, ({ params }) => {
            this.subscriptions.delete(params.uri);
            this.session.logger.debug({
                id: LogId.serverInitialized,
                context: "resources",
                message: `Client unsubscribed from resource: ${params.uri}`,
            });
            return {};
        });

        this.mcpServer.server.setRequestHandler(SetLevelRequestSchema, ({ params }) => {
            if (!MCP_LOG_LEVELS.includes(params.level)) {
                throw new Error(`Invalid log level: ${params.level}`);
            }

            const requestedIdx = MCP_LOG_LEVELS.indexOf(params.level);
            const floorIdx = MCP_LOG_LEVELS.indexOf(this.mcpLogLevelFloor);
            this._mcpLogLevel = requestedIdx >= floorIdx ? params.level : this.mcpLogLevelFloor;
            return {};
        });

        this.mcpServer.server.oninitialized = (): void => {
            this.session.setMcpClient(this.mcpServer.server.getClientVersion());
            // Placed here to start the connection to the config connection string as soon as the server is initialized.
            void this.connectToConfigConnectionString();
            this.session.logger.info({
                id: LogId.serverInitialized,
                context: "server",
                message: `Server with version ${this.packageInfo.version} started with transport ${transport.constructor.name} and agent runner ${JSON.stringify(this.session)}`,
            });

            this.emitServerTelemetryEvent("start", Date.now() - this.startTime);
        };

        this.mcpServer.server.onclose = (): void => {
            const closeTime = Date.now();
            this.emitServerTelemetryEvent("stop", Date.now() - closeTime);
        };

        this.mcpServer.server.onerror = (error: Error): void => {
            const closeTime = Date.now();
            this.emitServerTelemetryEvent("stop", Date.now() - closeTime, error);
        };

        await this.mcpServer.connect(transport);
    }

    async close(): Promise<void> {
        await this.telemetry.close();
        await this.session.close?.();
        await this.mcpServer.close();
    }

    public sendResourceListChanged(): void {
        this.mcpServer.sendResourceListChanged();
    }

    public isToolCategoryAvailable(name: ToolCategory): boolean {
        return !!this.tools.filter((t) => t.category === name).length;
    }

    public sendResourceUpdated(uri: string): void {
        this.session.logger.info({
            id: LogId.resourceUpdateFailure,
            context: "resources",
            message: `Resource updated: ${uri}`,
        });

        if (this.subscriptions.has(uri)) {
            void this.mcpServer.server.sendResourceUpdated({ uri });
        }
    }

    private emitServerTelemetryEvent(command: string, commandDuration: number, error?: Error): void {
        const event: { timestamp: string; source: string; properties: Record<string, unknown> } = {
            timestamp: new Date().toISOString(),
            source: "mdbmcp",
            properties: {
                result: "success",
                duration_ms: commandDuration,
                component: "server",
                category: "other",
                command: command,
            },
        };

        if (command === "start") {
            event.properties.startup_time_ms = commandDuration;
            event.properties.read_only_mode = this.userConfig.readOnly ? "true" : "false";
            event.properties.disabled_tools = this.userConfig.disabledTools || [];
            event.properties.confirmation_required_tools = this.userConfig.confirmationRequiredTools || [];
            event.properties.previewFeatures = this.userConfig.previewFeatures;
        }
        if (command === "stop") {
            event.properties.runtime_duration_ms = Date.now() - this.startTime;
            if (error) {
                event.properties.result = "failure";
                event.properties.error_type = error.name;
            }
        }

        this.telemetry.emitEvents([event]);
    }

    public registerTools(): void {
        for (const toolConstructor of this.toolConstructors) {
            const config = { ...this.userConfig, ...this.runtimeConfig };

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const tool = new (toolConstructor as any)({
                name: toolConstructor.toolName,
                category: toolConstructor.category,
                operationType: toolConstructor.operationType,
                session: this.session as any,
                config,
                telemetry: this.telemetry as any,
                elicitation: this.elicitation as any,
                metrics: this.metrics as any,
                uiRegistry: this.uiRegistry as any,
            });
            if (tool.register(this)) {
                this.tools.push(tool as AnyToolBase);
            }
        }
    }

    public registerResources(): void {
        for (const resourceConstructor of this.resourceConstructors) {
            const resource = new resourceConstructor(this.session, this.userConfig, this.telemetry);
            resource.register(this);
        }
    }

    private async validateConfig(): Promise<void> {
        // Validate connection string
        if (this.userConfig.connectionString) {
            try {
                // Connection string validation is done via injected function if needed
            } catch (error) {
                throw new Error(
                    "Connection string validation failed with error: " +
                        (error instanceof Error ? error.message : String(error)),
                    { cause: error }
                );
            }
        }

        // Validate API client credentials
        if (this.userConfig.apiClientId && this.userConfig.apiClientSecret) {
            try {
                if (!this.session.apiClient) {
                    throw new Error("API client is not available.");
                }

                try {
                    const apiBaseUrl = new URL(this.userConfig.apiBaseUrl);
                    if (apiBaseUrl.protocol !== "https:") {
                        // Log a warning, but don't error out. This is to allow for testing against local or non-HTTPS endpoints.
                        const message = `apiBaseUrl is configured to use ${apiBaseUrl.protocol}, which is not secure. It is strongly recommended to use HTTPS for secure communication.`;
                        this.session.logger.warning({
                            id: LogId.atlasApiBaseUrlInsecure,
                            context: "server",
                            message,
                        });
                    }
                } catch (error) {
                    throw new Error(`Invalid apiBaseUrl: ${error instanceof Error ? error.message : String(error)}`, {
                        cause: error,
                    });
                }

                await this.session.apiClient.validateAuthConfig();
            } catch (error) {
                if (this.userConfig.connectionString === undefined) {
                    throw new Error(
                        `Failed to connect to MongoDB Atlas instance using the credentials from the config: ${error instanceof Error ? error.message : String(error)}`,
                        { cause: error }
                    );
                }

                this.session.logger.warning({
                    id: LogId.atlasCheckCredentials,
                    context: "server",
                    message: `Failed to validate MongoDB Atlas API client credentials from the config: ${error instanceof Error ? error.message : String(error)}. Continuing since a connection string is also provided.`,
                });
            }
        }
    }

    private async connectToConfigConnectionString(): Promise<void> {
        if (this.userConfig.connectionString) {
            try {
                this.session.logger.info({
                    id: LogId.mongodbConnectTry,
                    context: "server",
                    message: `Detected a MongoDB connection string in the configuration, trying to connect...`,
                });
                await this.session.connectToConfiguredConnection();
            } catch (error) {
                // We don't throw an error here because we want to allow the server to start even if the connection string is invalid.
                this.session.logger.error({
                    id: LogId.mongodbConnectFailure,
                    context: "server",
                    message: `Failed to connect to MongoDB instance using the connection string from the config: ${error instanceof Error ? error.message : String(error)}`,
                });
            }
        }
    }
}
