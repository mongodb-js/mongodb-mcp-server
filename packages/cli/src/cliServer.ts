import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { LogLevel } from "@mongodb-js/mcp-core";
import { MCP_LOG_LEVELS, LogId } from "@mongodb-js/mcp-core";
import type { UserConfig } from "./config/userConfig.js";
import type { CallToolResult, IApiClient, ISession, IUIRegistry } from "@mongodb-js/mcp-types";
import {
    CallToolRequestSchema,
    SetLevelRequestSchema,
    SubscribeRequestSchema,
    UnsubscribeRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { type ConnectionErrorHandler, type ConnectionManager } from "@mongodb-js/mcp-tools-mongodb";
import type { Elicitation } from "@mongodb-js/mcp-core";
import type { AnyResourceClass, IMetrics, DefaultMetricDefinitions } from "@mongodb-js/mcp-types";
import type { AtlasTelemetry, TelemetryServerCommand, TelemetryServerEvent } from "@mongodb-js/mcp-atlas-telemetry";
import type { AnyToolBase, AnyToolClass, ToolCategory } from "@mongodb-js/mcp-core";
import { validateConnectionString } from "@mongodb-js/mcp-tools-mongodb";
import { type ServerMetadata } from "@mongodb-js/mcp-types";

/** A list of tool classes that can be instantiated. */
export type ToolRegistry = AnyToolClass[];

/** Resource constructor registry. */
export type ResourceRegistry = readonly AnyResourceClass[];

export interface CliServerOptions<TMetrics extends DefaultMetricDefinitions = DefaultMetricDefinitions> {
    session: McpSession;
    mcpServer: McpServer;
    telemetry: AtlasTelemetry;
    elicitation: Elicitation;
    /** @deprecated Will be removed in a future version. Use `CliSessionOptions.connectionErrorHandler` instead. */
    connectionErrorHandler: ConnectionErrorHandler;
    uiRegistry?: IUIRegistry;
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
     * To include internal tools, import `AllTools` from `mongodb-mcp-server`
     * and individual tool classes from the `@mongodb-js/mcp-tools-*` packages:
     *
     * ```typescript
     * import { AllTools } from "mongodb-mcp-server";
     * import { AggregateTool, FindTool } from "@mongodb-js/mcp-tools-mongodb";
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
     * to `ToolClass` type from `@mongodb-js/mcp-core` or `mongodb-mcp-server`.
     */
    tools?: ToolRegistry;
    /** Array of resource constructors to register. */
    readonly resources?: ResourceRegistry;
    readonly serverMetadata: ServerMetadata;
}

export type McpSession = ISession<UserConfig> & {
    apiClient: IApiClient;
    connectionManager: ConnectionManager;
    connectToConfiguredConnection: () => Promise<void>;
};

export class CliServer<TMetrics extends DefaultMetricDefinitions = DefaultMetricDefinitions> {
    public readonly session: McpSession;
    public readonly mcpServer: McpServer;
    private readonly telemetry: AtlasTelemetry;
    public readonly elicitation: Elicitation;
    private readonly toolConstructors: ToolRegistry;
    private readonly resourceConstructors: ResourceRegistry;
    public readonly tools: AnyToolBase[] = [];
    public readonly connectionErrorHandler: ConnectionErrorHandler;
    public readonly uiRegistry?: IUIRegistry;
    public readonly metrics: IMetrics<TMetrics>;
    public readonly serverMetadata: ServerMetadata;

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
        telemetry,
        connectionErrorHandler,
        elicitation,
        tools,
        resources,
        uiRegistry,
        metrics,
        serverMetadata,
    }: CliServerOptions<TMetrics> & { session: McpSession }) {
        this.startTime = Date.now();
        this.session = session;
        this.telemetry = telemetry;
        this.mcpServer = mcpServer;
        this.elicitation = elicitation;
        this.connectionErrorHandler = connectionErrorHandler;
        this.toolConstructors = tools ?? [];
        this.resourceConstructors = resources ?? [];
        this.uiRegistry = uiRegistry;
        this.metrics = metrics;
        this.serverMetadata = serverMetadata;

        this._mcpLogLevel = session.config.mcpClientLogLevel;
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
                message: `Server with version ${this.serverMetadata.version} started with transport ${transport.constructor.name} and agent runner ${JSON.stringify(this.session.mcpClient)}`,
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
        await this.session.close();
        await this.mcpServer.close();
    }

    public sendResourceListChanged(): void {
        this.mcpServer.sendResourceListChanged();
    }

    public isToolCategoryAvailable(name: ToolCategory): boolean {
        return !!this.tools.filter((t: AnyToolBase) => t.category === name).length;
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

    private emitServerTelemetryEvent(command: TelemetryServerCommand, commandDuration: number, error?: Error): void {
        const event: TelemetryServerEvent = {
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
            event.properties.read_only_mode = this.session.config.readOnly ? "true" : "false";
            event.properties.disabled_tools = this.session.config.disabledTools || [];
            event.properties.confirmation_required_tools = this.session.config.confirmationRequiredTools || [];
            event.properties.previewFeatures = this.session.config.previewFeatures;
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
            const tool = new toolConstructor({
                name: toolConstructor.toolName,
                category: toolConstructor.category,
                operationType: toolConstructor.operationType,
                session: this.session,
                telemetry: this.telemetry,
                elicitation: this.elicitation,
                metrics: this.metrics,
                uiRegistry: this.uiRegistry,
            });
            if (tool.register(this)) {
                this.tools.push(tool as AnyToolBase);
            }
        }
    }

    public registerResources(): void {
        for (const resourceConstructor of this.resourceConstructors) {
            const resource = new resourceConstructor({
                session: this.session,
                telemetry: this.telemetry,
                elicitation: this.elicitation,
                metrics: this.metrics,
            });
            resource.register(this);
        }
    }

    private async validateConfig(): Promise<void> {
        // Validate connection string
        if (this.session.config.connectionString) {
            try {
                validateConnectionString(this.session.config.connectionString, false);
            } catch (error) {
                throw new Error(
                    "Connection string validation failed with error: " +
                        (error instanceof Error ? error.message : String(error)),
                    { cause: error }
                );
            }
        }

        // Validate API client credentials
        if (this.session.config.apiClientId && this.session.config.apiClientSecret) {
            try {
                if (!this.session.apiClient) {
                    throw new Error("API client is not available.");
                }

                try {
                    const apiBaseUrl = new URL(this.session.config.apiBaseUrl);
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

                await this.session.apiClient?.validateAuthConfig();
            } catch (error) {
                if (this.session.config.connectionString === undefined) {
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
        if (this.session.config.connectionString) {
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
