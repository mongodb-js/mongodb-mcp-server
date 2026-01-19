import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Session } from "./common/session.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { Resources } from "./resources/resources.js";
import type { LogLevel } from "./common/logger.js";
import { LogId, McpLogger } from "./common/logger.js";
import type { Telemetry } from "./telemetry/telemetry.js";
import type { UserConfig } from "./common/config/userConfig.js";
import { type ServerEvent } from "./telemetry/types.js";
import { type ServerCommand } from "./telemetry/types.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { ConnectionStateConnected, ConnectionStateErrored } from "./common/connectionManager.js";
import { EventEmitter } from "events";
import type { MonitoringEvents } from "./monitoring/types.js";
import { MonitoringEventNames } from "./monitoring/types.js";
import {
    CallToolRequestSchema,
    SetLevelRequestSchema,
    SubscribeRequestSchema,
    UnsubscribeRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { ToolBase, ToolCategory, ToolClass } from "./tools/tool.js";
import { validateConnectionString } from "./helpers/connectionOptions.js";
import { packageInfo } from "./common/packageInfo.js";
import { type ConnectionErrorHandler } from "./common/connectionErrorHandler.js";
import type { Elicitation } from "./elicitation.js";
import { AllTools } from "./tools/index.js";
import { UIRegistry } from "./ui/registry/index.js";

export interface ServerOptions {
    session: Session;
    userConfig: UserConfig;
    mcpServer: McpServer;
    telemetry: Telemetry;
    elicitation: Elicitation;
    connectionErrorHandler: ConnectionErrorHandler;
    /**
     * Custom tool constructors to register with the server.
     * This will override any default tools. You can use both existing and custom tools by using the `mongodb-mcp-server/tools` export.
     *
     * ```ts
     * import { AllTools, ToolBase, type ToolCategory, type OperationType } from "mongodb-mcp-server/tools";
     * class CustomTool extends ToolBase {
     *     override name = "custom_tool";
     *     static category: ToolCategory = "mongodb";
     *     static operationType: OperationType = "read";
     *     public description = "Custom tool description";
     *     public argsShape = {};
     *     protected async execute() {
     *         return { content: [{ type: "text", text: "Result" }] };
     *     }
     *     protected resolveTelemetryMetadata() {
     *         return {};
     *     }
     * }
     * const server = new Server({
     *     session: mySession,
     *     userConfig: myUserConfig,
     *     mcpServer: myMcpServer,
     *     telemetry: myTelemetry,
     *     elicitation: myElicitation,
     *     connectionErrorHandler: myConnectionErrorHandler,
     *     tools: [...AllTools, CustomTool],
     * });
     * ```
     */
    tools?: ToolClass[];
    /**
     * Custom UIs for tools. Function that returns HTML strings for tool names.
     * Use this to add UIs to tools or replace the default bundled UIs.
     * The function is called lazily when a UI is requested, allowing you to
     * defer loading large HTML files until needed.
     *
     * ```ts
     * import { readFileSync } from 'fs';
     * const server = new Server({
     *     // ... other options
     *     customUIs: (toolName) => {
     *         if (toolName === 'list-databases') {
     *             return readFileSync('./my-custom-ui.html', 'utf-8');
     *         }
     *         return null;
     *     }
     * });
     * ```
     */
    customUIs?: (toolName: string) => string | null | Promise<string | null>;
}

export class Server {
    public readonly session: Session;
    public readonly mcpServer: McpServer;
    public readonly telemetry: Telemetry;
    public readonly userConfig: UserConfig;
    public readonly elicitation: Elicitation;
    private readonly toolConstructors: ToolClass[];
    public readonly tools: ToolBase[] = [];
    public readonly connectionErrorHandler: ConnectionErrorHandler;
    public readonly uiRegistry: UIRegistry;
    /**
     * Monitoring event emitter for internal observability and metrics collection.
     * Always active regardless of telemetry settings.
     * Use this for Prometheus metrics, logging, and other internal monitoring.
     */
    public readonly monitoring: EventEmitter<MonitoringEvents> = new EventEmitter();

    private _mcpLogLevel: LogLevel = "debug";

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
        customUIs,
    }: ServerOptions) {
        this.startTime = Date.now();
        this.session = session;
        this.telemetry = telemetry;
        this.mcpServer = mcpServer;
        this.userConfig = userConfig;
        this.elicitation = elicitation;
        this.connectionErrorHandler = connectionErrorHandler;
        this.toolConstructors = tools ?? AllTools;
        this.uiRegistry = new UIRegistry({ customUIs });

        // Track connection timing for telemetry
        this.setupConnectionTelemetry();
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
            if (!McpLogger.LOG_LEVELS.includes(params.level)) {
                throw new Error(`Invalid log level: ${params.level}`);
            }

            this._mcpLogLevel = params.level;
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
        const telemetryEvent: ServerEvent = {
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
            telemetryEvent.properties.startup_time_ms = commandDuration;
            telemetryEvent.properties.read_only_mode = this.userConfig.readOnly ? "true" : "false";
            telemetryEvent.properties.disabled_tools = this.userConfig.disabledTools || [];
            telemetryEvent.properties.confirmation_required_tools = this.userConfig.confirmationRequiredTools || [];
            telemetryEvent.properties.previewFeatures = this.userConfig.previewFeatures;
            telemetryEvent.properties.embeddingProviderConfigured = !!this.userConfig.voyageApiKey;
        }
        if (command === "stop") {
            telemetryEvent.properties.runtime_duration_ms = Date.now() - this.startTime;
            if (error) {
                telemetryEvent.properties.result = "failure";
                telemetryEvent.properties.reason = error.message;
            }
        }

        // Emit to telemetry (for analytics)
        this.telemetry.emitEvents([telemetryEvent]);

        // Emit to monitoring (for metrics) - separate event type
        const monitoringEvent: import("./monitoring/types.js").MonitoringServerEvent = {
            type: "server",
            timestamp: new Date().toISOString(),
            duration_ms: commandDuration,
            result: error ? "failure" : "success",
            command: command,
            metadata: {
                startup_time_ms: command === "start" ? commandDuration : undefined,
                runtime_duration_ms: command === "stop" ? Date.now() - this.startTime : undefined,
            },
        };
        this.monitoring.emit(MonitoringEventNames.SERVER_LIFECYCLE, monitoringEvent);
    }

    private connectionStartTime: number | undefined;

    private setupConnectionTelemetry(): void {
        // Track connection request (start timing)
        this.session.connectionManager.events.on("connection-request", () => {
            this.connectionStartTime = Date.now();
        });

        // Track successful connections
        this.session.connectionManager.events.on("connection-success", (state: ConnectionStateConnected) => {
            if (this.connectionStartTime !== undefined) {
                const duration = Date.now() - this.connectionStartTime;
                this.emitConnectionTelemetryEvent("connect", duration, "success", state);
                this.connectionStartTime = undefined;
            }
        });

        // Track connection errors
        this.session.connectionManager.events.on("connection-error", (state: ConnectionStateErrored) => {
            if (this.connectionStartTime !== undefined) {
                const duration = Date.now() - this.connectionStartTime;
                this.emitConnectionTelemetryEvent("connect", duration, "failure", state);
                this.connectionStartTime = undefined;
            }
        });

        // Track disconnections
        this.session.connectionManager.events.on("connection-close", () => {
            const startTime = Date.now();
            this.emitConnectionTelemetryEvent("disconnect", Date.now() - startTime, "success");
        });
    }

    private emitConnectionTelemetryEvent(
        command: "connect" | "disconnect",
        duration: number,
        result: "success" | "failure",
        state?: ConnectionStateConnected | ConnectionStateErrored
    ): void {
        // Emit to monitoring only - connection events are NOT sent to telemetry backend
        const monitoringEvent: import("./monitoring/types.js").MonitoringConnectionEvent = {
            type: "connection",
            timestamp: new Date().toISOString(),
            duration_ms: duration,
            result,
            command,
        };

        // Add optional properties only if they exist
        if (state?.connectionStringAuthType) {
            monitoringEvent.connection_type = state.connectionStringAuthType;
        }
        if (state?.connectedAtlasCluster?.clusterName) {
            monitoringEvent.cluster_name = state.connectedAtlasCluster.clusterName;
        }
        if (state?.connectedAtlasCluster) {
            monitoringEvent.is_atlas = true;
        }

        this.monitoring.emit(MonitoringEventNames.CONNECTION_LIFECYCLE, monitoringEvent);
    }

    public registerTools(): void {
        for (const toolConstructor of this.toolConstructors) {
            const tool = new toolConstructor({
                category: toolConstructor.category,
                operationType: toolConstructor.operationType,
                session: this.session,
                config: this.userConfig,
                telemetry: this.telemetry,
                elicitation: this.elicitation,
                uiRegistry: this.uiRegistry,
            });
            if (tool.register(this)) {
                this.tools.push(tool);
            }
        }
    }

    public registerResources(): void {
        for (const resourceConstructor of Resources) {
            const resource = new resourceConstructor(this.session, this.userConfig, this.telemetry);
            resource.register(this);
        }
    }

    private async validateConfig(): Promise<void> {
        // Validate connection string
        if (this.userConfig.connectionString) {
            try {
                validateConnectionString(this.userConfig.connectionString, false);
            } catch (error) {
                // eslint-disable-next-line no-console
                console.error("Connection string validation failed with error: ", error);
                throw new Error(
                    "Connection string validation failed with error: " +
                        (error instanceof Error ? error.message : String(error))
                );
            }
        }

        // Validate API client credentials
        if (this.userConfig.apiClientId && this.userConfig.apiClientSecret) {
            try {
                if (!this.session.apiClient) {
                    throw new Error("API client is not available.");
                }
                if (!this.userConfig.apiBaseUrl.startsWith("https://")) {
                    const message =
                        "Failed to validate MongoDB Atlas the credentials from config: apiBaseUrl must start with https://";
                    // eslint-disable-next-line no-console
                    console.error(message);
                    throw new Error(message);
                }

                await this.session.apiClient.validateAuthConfig();
            } catch (error) {
                if (this.userConfig.connectionString === undefined) {
                    // eslint-disable-next-line no-console
                    console.error("Failed to validate MongoDB Atlas the credentials from the config: ", error);

                    throw new Error(
                        "Failed to connect to MongoDB Atlas instance using the credentials from the config"
                    );
                }
                // eslint-disable-next-line no-console
                console.error(
                    "Failed to validate MongoDB Atlas credentials from the config, but validated the connection string."
                );
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
