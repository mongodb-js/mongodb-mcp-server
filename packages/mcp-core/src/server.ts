import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
    CallToolRequestSchema,
    SetLevelRequestSchema,
    SubscribeRequestSchema,
    UnsubscribeRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { IUIRegistry, ResourceClass } from "@mongodb-js/mcp-api";
import type { Metrics, DefaultMetrics } from "@mongodb-js/mcp-metrics";
import type { Session } from "./session.js";
import type { Telemetry, TelemetryEventLike } from "./telemetry/telemetry.js";
import type { Elicitation } from "./elicitation.js";
import type { LogLevel } from "./logging/index.js";
import { LogId, MCP_LOG_LEVELS } from "./logging/index.js";
import { Resources } from "./resources/resources.js";
import type { AnyToolBase, AnyToolClass, ToolCategory, ToolConfig } from "./tools/tool.js";
import { validateConnectionString } from "./helpers/connectionOptions.js";
import { packageInfo } from "./packageInfo.js";

export type { ToolCategory, AnyToolClass };

// `ConnectionErrorHandlerLike` is defined in `./session.ts` and re-exported via
// `./index.ts`. We import it here to keep the option types compatible.
import type { ConnectionErrorHandlerLike } from "./session.js";

export type { ConnectionErrorHandlerLike };

/**
 * Subset of UserConfig fields read by the `Server` class.
 */
export interface ServerConfig extends ToolConfig {
    connectionString?: string;
    apiClientId?: string;
    apiClientSecret?: string;
    apiBaseUrl: string;
    mcpClientLogLevel: LogLevel;
    /** Inherited from `ToolConfig`: readOnly, disabledTools, confirmationRequiredTools, previewFeatures, transport, httpBodyLimit. */
}

/**
 * Generic server-event payload type. Concrete telemetry event shapes live in
 * `@mongodb-js/mcp-cli-telemetry`.
 */
type ServerEventLike = TelemetryEventLike & {
    properties: {
        component: "server";
        category: "other";
        command: ServerCommand;
        duration_ms: number;
        result: "success" | "failure";
        startup_time_ms?: number;
        runtime_duration_ms?: number;
        read_only_mode?: "true" | "false";
        disabled_tools?: string[];
        confirmation_required_tools?: string[];
        previewFeatures?: string[];
        error_type?: string;
    } & Record<string, unknown>;
};

export type ServerCommand = "start" | "stop";

export interface ServerOptions<
    TConfig extends ServerConfig = ServerConfig,
    TContext = unknown,
    TMetrics extends DefaultMetrics = DefaultMetrics,
> {
    session: Session;
    userConfig: TConfig;
    mcpServer: McpServer;
    telemetry: Telemetry;
    elicitation: Elicitation;
    /** @deprecated Will be removed in a future version. Use `SessionOptions.connectionErrorHandler` instead. */
    connectionErrorHandler: ConnectionErrorHandlerLike;
    uiRegistry?: IUIRegistry;
    metrics: Metrics<TMetrics>;
    /**
     * An optional list of tool constructors to be registered with the MCP
     * server. When not provided, no tools are registered by default — callers
     * supply tool packages.
     */
    tools?: AnyToolClass[];
    /**
     * An optional list of resource constructors to be registered with the MCP
     * server. When not provided, defaults to the built-in `Resources` array
     * (currently empty). Callers can supply `ConfigResource`, `DebugResource`,
     * `ExportedData`, etc.
     */
    resources?: ReadonlyArray<ResourceClass>;
    /**
     * Custom context object made available to tools via `this.context`.
     */
    toolContext?: TContext;
}

export class Server<
    TConfig extends ServerConfig = ServerConfig,
    TContext = unknown,
    TMetrics extends DefaultMetrics = DefaultMetrics,
> {
    public readonly session: Session;
    public readonly mcpServer: McpServer;
    private readonly telemetry: Telemetry;
    public readonly userConfig: TConfig;
    public readonly elicitation: Elicitation;
    private readonly toolConstructors: AnyToolClass[];
    private readonly resourceConstructors: ReadonlyArray<ResourceClass>;
    public readonly tools: AnyToolBase[] = [];
    public readonly connectionErrorHandler: ConnectionErrorHandlerLike;
    public readonly uiRegistry?: IUIRegistry;
    public readonly toolContext?: TContext;
    public readonly metrics: Metrics<TMetrics>;

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
        toolContext,
        metrics,
    }: ServerOptions<TConfig, TContext, TMetrics>) {
        this.startTime = Date.now();
        this.session = session;
        this.telemetry = telemetry;
        this.mcpServer = mcpServer;
        this.userConfig = userConfig;
        this.elicitation = elicitation;
        this.connectionErrorHandler = connectionErrorHandler;
        this.toolConstructors = tools ?? [];
        this.resourceConstructors = resources ?? Resources;
        this.uiRegistry = uiRegistry;
        this.toolContext = toolContext;
        this.metrics = metrics;

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
                message: `Server with version ${packageInfo.version} started with transport ${transport.constructor.name} and agent runner ${JSON.stringify(this.session.mcpClient)}`,
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

    private emitServerTelemetryEvent(command: ServerCommand, commandDuration: number, error?: Error): void {
        const event: ServerEventLike = {
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
            const tool = new toolConstructor({
                name: toolConstructor.toolName,
                category: toolConstructor.category,
                operationType: toolConstructor.operationType,
                session: this.session,
                config: this.userConfig,
                telemetry: this.telemetry,
                elicitation: this.elicitation,
                metrics: this.metrics,
                uiRegistry: this.uiRegistry,
                context: this.toolContext,
            });
            if (tool.register(this)) {
                this.tools.push(tool);
            }
        }
    }

    public registerResources(): void {
        for (const resourceConstructor of this.resourceConstructors) {
            const resource = new resourceConstructor(this.session, this.userConfig, this.telemetry);
            (resource as { register: (server: Server<TConfig, TContext, TMetrics>) => void }).register(this);
        }
    }

    private async validateConfig(): Promise<void> {
        // Validate connection string
        if (this.userConfig.connectionString) {
            try {
                validateConnectionString(this.userConfig.connectionString, false);
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
