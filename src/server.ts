import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Session } from "./common/session.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { AtlasTools } from "./tools/atlas/tools.js";
import { AtlasLocalTools } from "./tools/atlasLocal/tools.js";
import { MongoDbTools } from "./tools/mongodb/tools.js";
import { Resources } from "./resources/resources.js";
import type { LogLevel } from "./common/logger.js";
import { LogId, McpLogger } from "./common/logger.js";
import type { Telemetry } from "./telemetry/telemetry.js";
import type { UserConfig } from "./common/config.js";
import { type ServerEvent } from "./telemetry/types.js";
import { type ServerCommand } from "./telemetry/types.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
    CallToolRequestSchema,
    SetLevelRequestSchema,
    SubscribeRequestSchema,
    UnsubscribeRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import assert from "assert";
import type { ToolBase, ToolCategory, ToolConstructorParams } from "./tools/tool.js";
import { validateConnectionString } from "./helpers/connectionOptions.js";
import { packageInfo } from "./common/packageInfo.js";
import { type ConnectionErrorHandler } from "./common/connectionErrorHandler.js";
import type { Elicitation } from "./elicitation.js";

export interface ServerOptions {
    session: Session;
    userConfig: UserConfig;
    mcpServer: McpServer;
    telemetry: Telemetry;
    elicitation: Elicitation;
    connectionErrorHandler: ConnectionErrorHandler;
    toolConstructors?: (new (params: ToolConstructorParams) => ToolBase)[];
}

export class Server {
    public readonly session: Session;
    public readonly mcpServer: McpServer;
    private readonly telemetry: Telemetry;
    public readonly userConfig: UserConfig;
    public readonly elicitation: Elicitation;
    private readonly toolConstructors: (new (params: ToolConstructorParams) => ToolBase)[];
    public readonly tools: ToolBase[] = [];
    public readonly connectionErrorHandler: ConnectionErrorHandler;

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
        toolConstructors,
    }: ServerOptions) {
        this.startTime = Date.now();
        this.session = session;
        this.telemetry = telemetry;
        this.mcpServer = mcpServer;
        this.userConfig = userConfig;
        this.elicitation = elicitation;
        this.connectionErrorHandler = connectionErrorHandler;
        this.toolConstructors = toolConstructors ?? [...AtlasTools, ...MongoDbTools, ...AtlasLocalTools];
    }

    async connect(transport: Transport): Promise<void> {
        await this.validateConfig();
        // Register resources after the server is initialized so they can listen to events like
        // connection events.
        this.registerResources();
        this.mcpServer.server.registerCapabilities({
            logging: {},
            resources: { listChanged: true, subscribe: true },
            instructions: this.getInstructions(),
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

        assert(existingHandler, "No existing handler found for CallToolRequestSchema");

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
            event.properties.read_only_mode = this.userConfig.readOnly ? "true" : "false";
            event.properties.disabled_tools = this.userConfig.disabledTools || [];
            event.properties.confirmation_required_tools = this.userConfig.confirmationRequiredTools || [];
        }
        if (command === "stop") {
            event.properties.runtime_duration_ms = Date.now() - this.startTime;
            if (error) {
                event.properties.result = "failure";
                event.properties.reason = error.message;
            }
        }

        this.telemetry.emitEvents([event]);
    }

    private registerTools(): void {
        for (const toolConstructor of this.toolConstructors) {
            const tool = new toolConstructor({
                session: this.session,
                config: this.userConfig,
                telemetry: this.telemetry,
                elicitation: this.elicitation,
            });
            if (tool.register(this)) {
                this.tools.push(tool);
            }
        }
    }

    private registerResources(): void {
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
                if (!this.userConfig.apiBaseUrl.startsWith("https://")) {
                    const message =
                        "Failed to validate MongoDB Atlas the credentials from config: apiBaseUrl must start with https://";
                    console.error(message);
                    throw new Error(message);
                }

                await this.session.apiClient.validateAccessToken();
            } catch (error) {
                if (this.userConfig.connectionString === undefined) {
                    console.error("Failed to validate MongoDB Atlas the credentials from the config: ", error);

                    throw new Error(
                        "Failed to connect to MongoDB Atlas instance using the credentials from the config"
                    );
                }
                console.error(
                    "Failed to validate MongoDB Atlas the credentials from the config, but validated the connection string."
                );
            }
        }
    }

    private getInstructions(): string {
        let instructions = `
            This is the MongoDB MCP server.
        `;
        if (this.userConfig.connectionString) {
            instructions += `
            This MCP server was configured with a MongoDB connection string, and you can assume that you are connected to a MongoDB cluster.
            `;
        }

        if (this.userConfig.apiClientId && this.userConfig.apiClientSecret) {
            instructions += `
            This MCP server was configured with MongoDB Atlas API credentials.`;
        }

        return instructions;
    }

    private async connectToConfigConnectionString(): Promise<void> {
        if (this.userConfig.connectionString) {
            try {
                this.session.logger.info({
                    id: LogId.mongodbConnectTry,
                    context: "server",
                    message: `Detected a MongoDB connection string in the configuration, trying to connect...`,
                });
                await this.session.connectToMongoDB({
                    connectionString: this.userConfig.connectionString,
                });
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
