import { AsyncLocalStorage } from "async_hooks";
import { z } from "zod";
import type { OperationType, ToolArgs, ToolCategory, ToolExecutionContext } from "../tool.js";
import { ToolBase } from "../tool.js";
import type { NodeDriverServiceProvider } from "@mongosh/service-provider-node-driver";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { ErrorCodes, MongoDBError } from "../../common/errors.js";
import { LogId } from "../../common/logging/index.js";
import type { Server } from "../../server.js";
import type { ConnectionMetadata } from "../../telemetry/types.js";
import { assertNoServerSideJS, isWriteStage } from "../../helpers/mqlGuards.js";

export const DBOperationArgs = {
    database: z.string().describe("Database name"),
    connection: z
        .string()
        .optional()
        .describe(
            "Name of a pre-configured connection (see the list-connections tool) to run this operation against. When omitted, the active/default connection is used."
        ),
};

export const CollOperationArgs = {
    ...DBOperationArgs,
    collection: z.string().describe("Collection name"),
};

/**
 * Per-call storage for the requested named `connection`. Threaded through
 * {@link AsyncLocalStorage} rather than instance state because tool instances
 * are per-session singletons reused across concurrent, pipelined calls — so the
 * requested name must not be stashed on `this`. ALS propagates across every
 * `await` within a single call chain while staying isolated per async call.
 */
interface ConnectionArgStore {
    connectionName?: string;
}

const connectionArgStore = new AsyncLocalStorage<ConnectionArgStore>();

function extractConnectionName(args: unknown): string | undefined {
    if (args && typeof args === "object" && "connection" in args) {
        const value = (args as { connection?: unknown }).connection;
        if (typeof value === "string" && value.length > 0) {
            return value;
        }
    }
    return undefined;
}

export abstract class MongoDBToolBase extends ToolBase {
    protected server?: Server;
    static category: ToolCategory = "mongodb";

    /**
     * Wraps the base tool invocation so the per-call `connection` argument is
     * available (via {@link AsyncLocalStorage}) to {@link ensureConnected}
     * throughout the entire async call chain, without stashing it on `this`.
     */
    public override invoke(
        args: ToolArgs<typeof this.argsShape>,
        context: ToolExecutionContext
    ): Promise<CallToolResult> {
        const connectionName = extractConnectionName(args);
        return connectionArgStore.run({ connectionName }, () => super.invoke(args, context));
    }

    protected async ensureConnected(): Promise<NodeDriverServiceProvider> {
        // When a named connection is supplied, resolve it from the registry on
        // its own dedicated provider without ever touching the session-default
        // slot. Failures here throw NamedConnection* errors, which deliberately
        // bypass the session-default connection recovery handler.
        const connectionName = connectionArgStore.getStore()?.connectionName;
        if (connectionName) {
            return this.session.connectionRegistry.resolve(connectionName);
        }

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
     */
    protected assertMqlIsAllowed(value: Record<string, unknown> | Record<string, unknown>[] | undefined): void {
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

    public register(server: Server): boolean {
        this.server = server;
        return super.register(server);
    }

    protected async handleError(error: unknown, args: ToolArgs<typeof this.argsShape>): Promise<CallToolResult> {
        if (error instanceof MongoDBError) {
            switch (error.code) {
                case ErrorCodes.NotConnectedToMongoDB:
                case ErrorCodes.MisconfiguredConnectionString: {
                    const connectionError = error as MongoDBError<
                        ErrorCodes.NotConnectedToMongoDB | ErrorCodes.MisconfiguredConnectionString
                    >;
                    const outcome = await this.session.connectionErrorHandler(connectionError, {
                        availableTools: this.server?.tools ?? [],
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
                    const CTA = this.server?.isToolCategoryAvailable("atlas-local" as unknown as ToolCategory)
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
