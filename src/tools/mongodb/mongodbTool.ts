import { z } from "zod";
import type { OperationType, ToolArgs, ToolCategory } from "../tool.js";
import { ToolBase } from "../tool.js";
import type { NodeDriverServiceProvider } from "@mongosh/service-provider-node-driver";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { ErrorCodes, MongoDBError } from "../../common/errors.js";
import type { ConnectionEntry } from "../../common/connectionRegistry.js";
import type { Server } from "../../server.js";
import type { ConnectionMetadata } from "../../telemetry/types.js";
import { assertNoServerSideJS, isWriteStage } from "../../helpers/mqlGuards.js";

export const DBOperationArgs = {
    database: z.string().describe("Database name"),
};

export const CollOperationArgs = {
    ...DBOperationArgs,
    collection: z.string().describe("Collection name"),
};

function connectionIdDescription({ hasPreconfiguredConnection }: { hasPreconfiguredConnection: boolean }): string {
    const preconfigured = hasPreconfiguredConnection
        ? ', or "preconfigured" to use the connection string the server was configured with'
        : "";
    return `The connection to run the operation against. Use the id returned by one of the connect tools${preconfigured}.`;
}

export const ConnectionIdArgs = {
    connectionId: z.string().describe(connectionIdDescription({ hasPreconfiguredConnection: true })),
};

export abstract class MongoDBToolBase extends ToolBase {
    protected server?: Server;
    static category: ToolCategory = "mongodb";

    /**
     * Resolves the required `connectionId` argument to a live service provider
     * via the app-level connection registry. There is deliberately no implicit
     * "current connection" fallback — see the connection-handles proposal.
     */
    protected async resolveConnection(connectionId: string): Promise<NodeDriverServiceProvider> {
        return this.session.connectionRegistry.resolve(connectionId);
    }

    /** The registry entry for the given connectionId, if it exists. Does not affect LRU ordering. */
    protected async peekConnection(connectionId: string | undefined): Promise<ConnectionEntry | undefined> {
        return connectionId ? this.session.connectionRegistry.peek(connectionId) : undefined;
    }

    protected async isSearchSupported(connectionId: string): Promise<boolean> {
        const entry = await this.session.connectionRegistry.peek(connectionId);
        return entry ? entry.isSearchSupported(this.session.logger) : false;
    }

    protected async assertSearchSupported(connectionId: string): Promise<void> {
        if (!(await this.isSearchSupported(connectionId))) {
            throw new MongoDBError(
                ErrorCodes.AtlasSearchNotSupported,
                "Atlas Search is not supported in the current cluster."
            );
        }
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

    public register(server: Server): boolean {
        this.server = server;
        // The default connectionId description advertises the "preconfigured"
        // handle; drop that mention when no connection string is configured.
        if ("connectionId" in this.argsShape && !this.config.connectionString) {
            this.argsShape = {
                ...this.argsShape,
                connectionId: z.string().describe(connectionIdDescription({ hasPreconfiguredConnection: false })),
            };
        }
        return super.register(server);
    }

    protected async handleError(error: unknown, args: ToolArgs<typeof this.argsShape>): Promise<CallToolResult> {
        if (error instanceof MongoDBError) {
            switch (error.code) {
                case ErrorCodes.NotConnectedToMongoDB:
                case ErrorCodes.MisconfiguredConnectionString:
                case ErrorCodes.UnknownConnectionId: {
                    const connectionError = error as MongoDBError<
                        | ErrorCodes.NotConnectedToMongoDB
                        | ErrorCodes.MisconfiguredConnectionString
                        | ErrorCodes.UnknownConnectionId
                    >;
                    const outcome = await this.session.connectionErrorHandler(connectionError, {
                        availableTools: this.server?.tools ?? [],
                        connectionState: (await this.peekConnection(args.connectionId as string | undefined))?.state,
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
    protected async resolveTelemetryMetadata(
        args: ToolArgs<typeof this.argsShape>,
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        { result }: { result: CallToolResult }
    ): Promise<ConnectionMetadata> {
        const { connectionId } = args as { connectionId?: string };
        return {
            ...(connectionId && { connection_id: connectionId }),
            ...this.getConnectionInfoMetadata((await this.peekConnection(connectionId))?.state),
        };
    }
}
