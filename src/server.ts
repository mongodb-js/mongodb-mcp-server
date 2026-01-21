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
import type { MonitoringEvents, MonitoringServerEvent, MonitoringServerCommandType, MonitoringConnectionCommandType, MonitoringConnectionEvent } from "./monitoring/types.js";
import { MonitoringEventNames, MonitoringConnectionCommand } from "./monitoring/types.js";
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
     * Monitoring event emitter for internal observability and metrics collection.
     * This is injected from the transport runner to allow external monitoring.
     */
    monitoring: EventEmitter<MonitoringEvents>;
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
     *     monitoring: myMonitoring,
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
    private readonly telemetry: Telemetry;
    public readonly userConfig: UserConfig;
    public readonly elicitation: Elicitation;
    private readonly toolConstructors: ToolClass[];
    public readonly tools: ToolBase[] = [];
    public readonly connectionErrorHandler: ConnectionErrorHandler;
    public readonly uiRegistry: UIRegistry;
    /**
     * Monitoring event emitter for internal observability and metrics collection.
     * Always active regardless of telemetry settings.
     * Use this for metrics, logging, and other internal monitoring.
     * Injected from the transport runner.
     */
    public readonly monitoring: EventEmitter<MonitoringEvents>;

    private _mcpLogLevel: LogLevel = "debug";

    public get mcpLogLevel(): LogLevel {
        return this._mcpLogLevel;
    }

    private readonly startTime: number;
    private readonly subscriptions = new Set<string>();

    // Store event listener references for cleanup
    private connectionMonitoringListeners?: {
        onRequest: () => void;
        onSuccess: (state: ConnectionStateConnected) => void;
        onError: (state: ConnectionStateErrored) => void;
        onClose: () => void;
    };

    constructor({
        session,
        mcpServer,
        userConfig,
        telemetry,
        connectionErrorHandler,
        elicitation,
        monitoring,
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
        this.monitoring = monitoring;
        this.toolConstructors = tools ?? AllTools;
        this.uiRegistry = new UIRegistry({ customUIs });

        // Track connection timing for monitoring
        this.setupConnectionMonitoring();
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
        // Clean up connection monitoring event listeners
        this.cleanupConnectionMonitoring();

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
        const monitoringEvent: MonitoringServerEvent = {
            type: "server",
            timestamp: new Date().toISOString(),
            duration_ms: commandDuration,
            result: error ? "failure" : "success",
            command: command as MonitoringServerCommandType,
            metadata: {
                startup_time_ms: command === "start" ? commandDuration : undefined,
                runtime_duration_ms: command === "stop" ? Date.now() - this.startTime : undefined,
            },
        };
        this.monitoring.emit(MonitoringEventNames.SERVER_LIFECYCLE, monitoringEvent);
    }

    private setupConnectionMonitoring(): void {
        // Track connection start time in closure scope for better encapsulation
        let connectionStartTime: number | undefined;

        // Define event listeners and store references for cleanup
        const onRequest = (): void => {
            if (connectionStartTime === undefined) {
                connectionStartTime = Date.now();
            }
        };

        const onSuccess = (state: ConnectionStateConnected): void => {
            if (connectionStartTime !== undefined) {
                const duration = Date.now() - connectionStartTime;
                this.emitConnectionMonitoringEvent(MonitoringConnectionCommand.CONNECT, duration, "success", state);
                connectionStartTime = undefined;
            }
        };

        const onError = (state: ConnectionStateErrored): void => {
            if (connectionStartTime !== undefined) {
                const duration = Date.now() - connectionStartTime;
                this.emitConnectionMonitoringEvent(MonitoringConnectionCommand.CONNECT, duration, "failure", state);
                connectionStartTime = undefined;
            }
        };

        const onClose = (): void => {
            // Duration is 0 for disconnect events as it's not meaningful
            this.emitConnectionMonitoringEvent(MonitoringConnectionCommand.DISCONNECT, 0, "success");
        };

        // Store listener references for cleanup
        (this.connectionMonitoringListeners as typeof this.connectionMonitoringListeners) = {
            onRequest,
            onSuccess,
            onError,
            onClose,
        };

        // Register event listeners
        // Note: Multiple connection-request events can be emitted during a single connection attempt
        // (e.g., for OIDC flows), so we only set the start time if it's not already set
        this.session.connectionManager.events.on("connection-request", onRequest);
        this.session.connectionManager.events.on("connection-success", onSuccess);
        this.session.connectionManager.events.on("connection-error", onError);
        this.session.connectionManager.events.on("connection-close", onClose);
    }

    /**
     * Clean up connection monitoring event listeners.
     * Should be called when the server is being closed.
     */
    private cleanupConnectionMonitoring(): void {
        if (!this.connectionMonitoringListeners) {
            return;
        }

        this.session.connectionManager.events.off("connection-request", this.connectionMonitoringListeners.onRequest);
        this.session.connectionManager.events.off("connection-success", this.connectionMonitoringListeners.onSuccess);
        this.session.connectionManager.events.off("connection-error", this.connectionMonitoringListeners.onError);
        this.session.connectionManager.events.off("connection-close", this.connectionMonitoringListeners.onClose);
    }

    private emitConnectionMonitoringEvent(
        command: MonitoringConnectionCommandType,
        duration: number,
        result: "success" | "failure",
        state?: ConnectionStateConnected | ConnectionStateErrored
    ): void {
        // Emit to monitoring only - connection events are NOT sent to telemetry backend
        const monitoringEvent: MonitoringConnectionEvent = {
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
        if (state?.connectedAtlasCluster) {
            monitoringEvent.is_atlas = true;
            if (state.connectedAtlasCluster.clusterName) {
                monitoringEvent.cluster_name = state.connectedAtlasCluster.clusterName;
            }
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
