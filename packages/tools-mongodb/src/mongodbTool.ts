import { z } from "zod";
import type { ToolArgs, ToolConstructorParams } from "@mongodb-js/mcp-core";
import type { McpServer, ToolCategory, OperationType } from "@mongodb-js/mcp-types";
import { ToolBase } from "@mongodb-js/mcp-core";
import type { NodeDriverServiceProvider } from "@mongosh/service-provider-node-driver";
import type { CallToolResult, ISession, IToolConfig } from "@mongodb-js/mcp-types";
import { LogId } from "@mongodb-js/mcp-core";
import { ErrorCodes, MongoDBError } from "./common/errors.js";
import { assertNoServerSideJS, isWriteStage } from "./helpers/mqlGuards.js";
import type { ConnectionMetadata } from "@mongodb-js/mcp-types";
import type { AvailableExport, CreateJSONExportParams } from "./common/exportsManager.js";

/** MongoDB tool subset of server config. */
export type IMongoDBConfig = IToolConfig & {
    connectionString: string | undefined;
    indexCheck: boolean;
    disableServerSideJs: boolean;
    maxTimeMS: number | undefined;
    maxDocumentsPerQuery: number;
    maxBytesPerQuery: number;
    httpHost: string;
    queryCountMaxTimeMsCap: number;
    aggregationCountMaxTimeMsCap: number;
};

export interface IMongoDBSession extends ISession {
    config: IMongoDBConfig;
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

export abstract class MongoDBToolBase extends ToolBase<IMongoDBSession> {
    declare protected readonly session: IMongoDBSession;
    static category: ToolCategory = "mongodb";

    /** Host MCP server instance set in {@link MongoDBToolBase.register} (same object passed from {@link Server.registerTools}). */
    protected server?: MongoDBToolRegistrationServer;

    /** Access to the MongoDB-specific configuration. */
    protected get config(): IMongoDBConfig {
        return this.session.config;
    }

    constructor(params: ToolConstructorParams<IMongoDBSession>) {
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

    /**
     * Rejects the operation when the provided MQL input is not permitted by the
     * current configuration:
     *  - server-side JavaScript operators (such as $where, $function, or
     *    $accumulator) are rejected when the `disableServerSideJs` configuration
     *    option is enabled. This applies to both query filters and aggregation
     *    pipelines.
     *  - aggregation pipelines containing a write stage ($out or $merge) are
     *    rejected in readOnly mode or when create/update/delete operations are
     *    disabled. This prevents read-oriented tools such as aggregate and
     *    export from being used to circumvent those restrictions.
     *
     * Write stages only exist in aggregation pipelines, which are passed as an
     * array, so that check is skipped for plain query filters.
     *
     * Pass every operator-bearing fragment that reaches the server (e.g. filter
     * and projection for a find), since each is validated independently.
     */
    protected assertMqlIsAllowed(...values: (Record<string, unknown> | Record<string, unknown>[] | undefined)[]): void {
        for (const value of values) {
            this.assertSingleMqlValueIsAllowed(value);
        }
    }

    private assertSingleMqlValueIsAllowed(
        value: Record<string, unknown> | Record<string, unknown>[] | undefined
    ): void {
        if (this.config.disableServerSideJs) {
            assertNoServerSideJS(value);
        }

        if (Array.isArray(value)) {
            // Only check for forbidden write stages when the value is an array, which indicates it's an
            // aggregation pipeline. Query filters are objects, so they won't be checked for write stages,
            // which is correct since they can't contain them.
            const writeOperations: OperationType[] = ["update", "create", "delete"];

            let writeStageForbiddenErrorMessage = "";
            if (this.config.readOnly) {
                writeStageForbiddenErrorMessage =
                    "In readOnly mode you can not run pipelines with $out or $merge stages.";
            } else if (this.config.disabledTools.some((t) => writeOperations.includes(t as OperationType))) {
                writeStageForbiddenErrorMessage =
                    "When 'create', 'update', or 'delete' operations are disabled, you can not run pipelines with $out or $merge stages.";
            }

            if (writeStageForbiddenErrorMessage) {
                for (const stage of value) {
                    if (isWriteStage(stage)) {
                        throw new MongoDBError(ErrorCodes.ForbiddenWriteOperation, writeStageForbiddenErrorMessage);
                    }
                }
            }
        }
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
