import { z } from "zod";
import type { McpServer, ToolArgs, ToolCategory, ToolConstructorParams } from "@mongodb-js/mcp-core";
import { ToolBase } from "@mongodb-js/mcp-core";
import type { NodeDriverServiceProvider } from "@mongosh/service-provider-node-driver";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { ErrorCodes, MongoDBError } from "./common/errors.js";
import { LogId } from "@mongodb-js/mcp-logging";
import type { ConnectionMetadata, IToolConfig, IToolSession } from "@mongodb-js/mcp-types";
import type { AvailableExport, CreateJSONExportParams } from "./common/exportsManager.js";

/** MongoDB tool subset of server config. */
export type IMongoDBConfig = IToolConfig & {
    connectionString: string | undefined;
    indexCheck: boolean;
    maxTimeMS: number | undefined;
    maxDocumentsPerQuery: number;
    maxBytesPerQuery: number;
    httpHost: string;
    queryCountMaxTimeMsCap: number;
    aggregationCountMaxTimeMsCap: number;
};

export interface IMongoDBSession extends IToolSession {
    isConnectedToMongoDB: boolean;
    connectedAtlasCluster?: { clusterName: string; projectId: string };
    serviceProvider: NodeDriverServiceProvider;
    connectToConfiguredConnection(): Promise<void>;
    connectToMongoDB(settings: { connectionString: string }): Promise<void>;
    connectionErrorHandler(
        error: MongoDBError,
        context: { availableTools: unknown[]; connectionState: unknown }
    ): Promise<{ errorHandled: boolean; result: CallToolResult }>;
    connectionManager: { currentConnectionState: unknown };
    exportsManager: { createJSONExport: (params: CreateJSONExportParams) => Promise<AvailableExport> };
    assertSearchSupported(): Promise<void>;
    isSearchSupported(): Promise<boolean>;
    on(event: "connect" | "disconnect", listener: () => void): void;
}

export const DBOperationArgs = {
    database: z.string().describe("Database name"),
};

export const CollOperationArgs = {
    ...DBOperationArgs,
    collection: z.string().describe("Collection name"),
};

/**
 * MCP registration payload for MongoDB tools. Matches `{ mcpServer }` from {@link ToolBase.register}
 * plus optional host context used when rendering connection errors.
 */
export type MongoDBToolRegistrationServer = {
    mcpServer: McpServer;
    readonly tools?: readonly unknown[];
    isToolCategoryAvailable(name: ToolCategory): boolean;
};

export abstract class MongoDBToolBase extends ToolBase<IMongoDBConfig> {
    declare protected readonly config: IMongoDBConfig;
    declare protected readonly session: IMongoDBSession;
    static category: ToolCategory = "mongodb";

    /** Host MCP server instance set in {@link MongoDBToolBase.register} (same object passed from {@link Server.registerTools}). */
    protected server?: MongoDBToolRegistrationServer;

    constructor(params: ToolConstructorParams<IMongoDBConfig>) {
        super(params);
    }

    /** Effective maxTimeMS for find countDocuments. */
    protected getFindCountDocumentsMaxTimeMS(): number {
        const cap = this.config.queryCountMaxTimeMsCap;
        return this.config.maxTimeMS !== undefined ? Math.min(this.config.maxTimeMS, cap) : cap;
    }

    /** Effective maxTimeMS for aggregation preliminary $count. */
    protected getAggregationCountDocumentsMaxTimeMS(): number {
        const cap = this.config.aggregationCountMaxTimeMsCap;
        return this.config.maxTimeMS !== undefined ? Math.min(this.config.maxTimeMS, cap) : cap;
    }

    public override register(server: MongoDBToolRegistrationServer): boolean {
        this.server = server;
        return super.register(server);
    }

    protected async ensureConnected(): Promise<NodeDriverServiceProvider> {
        if (!this.session.isConnectedToMongoDB) {
            if (this.session.connectedAtlasCluster) {
                throw new MongoDBError(
                    ErrorCodes.NotConnectedToMongoDB,
                    `Attempting to connect to Atlas cluster "${this.session.connectedAtlasCluster.clusterName}", try again in a few seconds.`
                );
            }

            if (this.config.connectionString) {
                try {
                    await this.session.connectToConfiguredConnection();
                } catch (error) {
                    this.session.logger.error({
                        id: LogId.mongodbConnectFailure,
                        context: "mongodbTool",
                        message: `Failed to connect to MongoDB instance using the connection string from the config: ${error as string}`,
                    });
                    throw new MongoDBError(ErrorCodes.MisconfiguredConnectionString, "Not connected to MongoDB.");
                }
            }
        }

        if (!this.session.isConnectedToMongoDB) {
            throw new MongoDBError(ErrorCodes.NotConnectedToMongoDB, "Not connected to MongoDB");
        }

        return this.session.serviceProvider;
    }

    /**
     * Returns common operation options (signal, maxTimeMS) to pass to service provider methods.
     * If `maxTimeMS` is configured, it will be included in the returned options.
     */
    protected getOperationOptions(signal?: AbortSignal): { signal?: AbortSignal; maxTimeMS?: number } {
        return {
            ...(signal && { signal }),
            ...(this.config.maxTimeMS !== undefined && { maxTimeMS: this.config.maxTimeMS }),
        };
    }

    protected async handleError(error: unknown, args: ToolArgs<typeof this.argsShape>): Promise<CallToolResult> {
        if (error instanceof MongoDBError) {
            switch (error.code) {
                case ErrorCodes.NotConnectedToMongoDB:
                case ErrorCodes.MisconfiguredConnectionString: {
                    const connectionError = error as MongoDBError;
                    const outcome = await this.session.connectionErrorHandler(connectionError, {
                        availableTools: [...(this.server?.tools ?? [])],
                        connectionState: this.session.connectionManager.currentConnectionState,
                    });
                    if (outcome.errorHandled) {
                        return outcome.result;
                    }

                    return super.handleError(error, args);
                }
                case ErrorCodes.ForbiddenCollscan:
                    return {
                        content: [
                            {
                                type: "text",
                                text: error.message,
                            },
                        ],
                        isError: true,
                    };
                case ErrorCodes.AtlasSearchNotSupported: {
                    const CTA = this.server?.isToolCategoryAvailable("atlas-local")
                        ? "`atlas-local` tools"
                        : "Atlas CLI";
                    return {
                        content: [
                            {
                                text: `The connected MongoDB deployment does not support vector search indexes. Either connect to a MongoDB Atlas cluster or use the ${CTA} to create and manage a local Atlas deployment.`,
                                type: "text",
                            },
                        ],
                        isError: true,
                    };
                }
            }
        }

        return super.handleError(error, args);
    }

    /**
     * Resolves the tool metadata from the arguments passed to the mongoDB tools.
     *
     * Since MongoDB tools are executed against a MongoDB instance, the tool calls will always have the connection information.
     *
     * @param result - The result of the tool call.
     * @param args - The arguments passed to the tool
     * @returns The tool metadata
     */
    protected resolveTelemetryMetadata(
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        _args: ToolArgs<typeof this.argsShape>,
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        { result }: { result: CallToolResult }
    ): ConnectionMetadata {
        return this.getConnectionInfoMetadata();
    }
}
