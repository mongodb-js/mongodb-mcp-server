import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Session } from "./common/session.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { AtlasTools } from "./tools/atlas/tools.js";
import { MongoDbTools } from "./tools/mongodb/tools.js";
import { Resources } from "./resources/resources.js";
import type { LogLevel } from "./common/logger.js";
import { LogId } from "./common/logger.js";
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
import type { ToolBase } from "./tools/tool.js";
import { validateConnectionString } from "./helpers/connectionOptions.js";

export interface ServerOptions {
    session: Session;
    userConfig: UserConfig;
    mcpServer: McpServer;
    telemetry: Telemetry;
}

export class Server {
    public readonly session: Session;
    public readonly mcpServer: McpServer;
    private readonly telemetry: Telemetry;
    public readonly userConfig: UserConfig;
    public readonly tools: ToolBase[] = [];

    private _mcpLogLevel: LogLevel = "debug";

    public get mcpLogLevel(): LogLevel {
        return this._mcpLogLevel;
    }

    private readonly startTime: number;
    private readonly subscriptions = new Set<string>();

    constructor({ session, mcpServer, userConfig, telemetry }: ServerOptions) {
        this.startTime = Date.now();
        this.session = session;
        this.telemetry = telemetry;
        this.mcpServer = mcpServer;
        this.userConfig = userConfig;
    }

    async connect(transport: Transport): Promise<void> {
        // Resources are now reactive, so we register them ASAP so they can listen to events like
        // connection events.
        this.registerResources();
        await this.validateConfig();

        this.mcpServer.server.registerCapabilities({ logging: {}, resources: { listChanged: true, subscribe: true } });

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
                message: `Server started with transport ${transport.constructor.name} and agent runner ${this.session.mcpClient?.name}`,
            });

            this.emitServerEvent("start", Date.now() - this.startTime);
        };

        this.mcpServer.server.onclose = (): void => {
            const closeTime = Date.now();
            this.emitServerEvent("stop", Date.now() - closeTime);
        };

        this.mcpServer.server.onerror = (error: Error): void => {
            const closeTime = Date.now();
            this.emitServerEvent("stop", Date.now() - closeTime, error);
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

    public sendResourceUpdated(uri: string): void {
        if (this.subscriptions.has(uri)) {
            void this.mcpServer.server.sendResourceUpdated({ uri });
        }
    }

    /**
     * Emits a server event
     * @param command - The server command (e.g., "start", "stop", "register", "deregister")
     * @param additionalProperties - Additional properties specific to the event
     */
    private emitServerEvent(command: ServerCommand, commandDuration: number, error?: Error): void {
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
            event.properties.read_only_mode = this.userConfig.readOnly || false;
            event.properties.disabled_tools = this.userConfig.disabledTools || [];
        }
        if (command === "stop") {
            event.properties.runtime_duration_ms = Date.now() - this.startTime;
            if (error) {
                event.properties.result = "failure";
                event.properties.reason = error.message;
            }
        }

        this.telemetry.emitEvents([event]).catch(() => {});
    }

    private registerTools(): void {
        for (const toolConstructor of [...AtlasTools, ...MongoDbTools]) {
            const tool = new toolConstructor(this.session, this.userConfig, this.telemetry);
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

    private async connectToConfigConnectionString(): Promise<void> {
        if (this.userConfig.connectionString) {
            try {
                await this.session.connectToMongoDB({
                    connectionString: this.userConfig.connectionString,
                });
            } catch (error) {
                console.error(
                    "Failed to connect to MongoDB instance using the connection string from the config: ",
                    error
                );
                throw new Error("Failed to connect to MongoDB instance using the connection string from the config");
            }
        }
    }
}
