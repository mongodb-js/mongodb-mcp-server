import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Session } from "./common/session.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { LogLevel } from "./common/logging/index.js";
import { LogId, MCP_LOG_LEVELS } from "./common/logging/index.js";
import type { Telemetry } from "./telemetry/telemetry.js";
import { type ServerEvent } from "./telemetry/types.js";
import { type ServerCommand } from "./telemetry/types.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
    CallToolRequestSchema,
    SetLevelRequestSchema,
    SubscribeRequestSchema,
    UnsubscribeRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { AnyToolBase, ToolCategory, ToolClass } from "./tools/tool.js";
import { validateConnectionString } from "./helpers/connectionOptions.js";
import { packageInfo } from "./common/packageInfo.js";
import { type ConnectionErrorHandler } from "./common/connectionErrorHandler.js";
import type { Elicitation } from "./elicitation.js";
import { AllTools } from "./tools/index.js";
import type { UIRegistry } from "./ui/registry/index.js";
import type { Metrics, DefaultMetrics } from "@mongodb-mcp/monitoring";
import type { ServerResource } from "./resources/resource.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyToolClass = ToolClass<any, any, any>;

export interface TelemetryMetadata {
    readOnly: boolean;
    disabledTools: string[];
    confirmationRequiredTools: string[];
    previewFeatures: string[];
}

export interface ServerRunnerOptions {
    mcpClientLogLevel: LogLevel;
    connectionString?: string;
    apiClientId?: string;
    apiClientSecret?: string;
    apiBaseUrl: string;
    telemetryMetadata: TelemetryMetadata;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    toolConfig: any;
}

export interface ServerOptions<TContext = unknown, TMetrics extends DefaultMetrics = DefaultMetrics> {
    session: Session;
    mcpServer: McpServer;
    telemetry: Telemetry;
    elicitation: Elicitation;
    /** @deprecated Will be removed in a future version. Use `SessionOptions.connectionErrorHandler` instead. */
    connectionErrorHandler: ConnectionErrorHandler;
    metrics: Metrics<TMetrics>;
    uiRegistry?: UIRegistry;
    options: ServerRunnerOptions;
    tools?: AnyToolClass[];
    resources?: ServerResource[];
    toolContext?: TContext;
}

export class Server<TContext = unknown, TMetrics extends DefaultMetrics = DefaultMetrics> {
    public readonly session: Session;
    public readonly mcpServer: McpServer;
    private readonly telemetry: Telemetry;
    public readonly elicitation: Elicitation;
    private readonly toolConstructors: AnyToolClass[];
    private readonly resourceInstances: ServerResource[];
    public readonly tools: AnyToolBase[] = [];
    public readonly connectionErrorHandler: ConnectionErrorHandler;
    public readonly uiRegistry?: UIRegistry;
    public readonly toolContext?: TContext;
    public readonly metrics: Metrics<TMetrics>;

    private readonly options: ServerRunnerOptions;

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
        toolContext,
        metrics,
        options,
    }: ServerOptions<TContext, TMetrics>) {
        this.startTime = Date.now();
        this.session = session;
        this.telemetry = telemetry;
        this.mcpServer = mcpServer;
        this.elicitation = elicitation;
        this.connectionErrorHandler = connectionErrorHandler;
        this.toolConstructors = tools ?? AllTools;
        this.resourceInstances = resources ?? [];
        this.uiRegistry = uiRegistry;
        this.toolContext = toolContext;
        this.metrics = metrics;
        this.options = options;

        this._mcpLogLevel = options.mcpClientLogLevel;
        this.mcpLogLevelFloor = this._mcpLogLevel;
    }

    async connect(transport: Transport): Promise<void> {
        await this.validateConfig();
        this.registerResources();
        this.mcpServer.server.registerCapabilities({
            logging: {},
            resources: { listChanged: true, subscribe: true },
        });

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
        const event: ServerEvent = {
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
            event.properties.read_only_mode = this.options.telemetryMetadata.readOnly ? "true" : "false";
            event.properties.disabled_tools = this.options.telemetryMetadata.disabledTools || [];
            event.properties.confirmation_required_tools =
                this.options.telemetryMetadata.confirmationRequiredTools || [];
            event.properties.previewFeatures = this.options.telemetryMetadata.previewFeatures;
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
                config: this.options.toolConfig, // eslint-disable-line @typescript-eslint/no-unsafe-assignment
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
        for (const resource of this.resourceInstances) {
            resource.register(this);
        }
    }

    private async validateConfig(): Promise<void> {
        if (this.options.connectionString) {
            try {
                validateConnectionString(this.options.connectionString, false);
            } catch (error) {
                throw new Error(
                    "Connection string validation failed with error: " +
                        (error instanceof Error ? error.message : String(error))
                );
            }
        }

        if (this.options.apiClientId && this.options.apiClientSecret) {
            try {
                if (!this.session.apiClient) {
                    throw new Error("API client is not available.");
                }

                try {
                    const apiBaseUrl = new URL(this.options.apiBaseUrl);
                    if (apiBaseUrl.protocol !== "https:") {
                        const message = `apiBaseUrl is configured to use ${apiBaseUrl.protocol}, which is not secure. It is strongly recommended to use HTTPS for secure communication.`;
                        this.session.logger.warning({
                            id: LogId.atlasApiBaseUrlInsecure,
                            context: "server",
                            message,
                        });
                    }
                } catch (error) {
                    throw new Error(`Invalid apiBaseUrl: ${error instanceof Error ? error.message : String(error)}`);
                }

                await this.session.apiClient.validateAuthConfig();
            } catch (error) {
                if (this.options.connectionString === undefined) {
                    throw new Error(
                        `Failed to connect to MongoDB Atlas instance using the credentials from the config: ${error instanceof Error ? error.message : String(error)}`
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
        if (this.options.connectionString) {
            try {
                this.session.logger.info({
                    id: LogId.mongodbConnectTry,
                    context: "server",
                    message: `Detected a MongoDB connection string in the configuration, trying to connect...`,
                });
                await this.session.connectToConfiguredConnection();
            } catch (error) {
                this.session.logger.error({
                    id: LogId.mongodbConnectFailure,
                    context: "server",
                    message: `Failed to connect to MongoDB instance using the connection string from the config: ${error instanceof Error ? error.message : String(error)}`,
                });
            }
        }
    }
}
