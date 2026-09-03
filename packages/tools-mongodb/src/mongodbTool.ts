import { z } from "zod";
import type { ToolArgs, InputRequiredResult } from "@mongodb-js/mcp-core";
import { ToolBase } from "@mongodb-js/mcp-core";
import type {
    ToolCategory,
    OperationType,
    ToolExecutionContext,
    ToolRequest,
    CallToolResult,
    ToolServices,
    ToolServer,
    ToolServerTool,
    IToolConfig,
} from "@mongodb-js/mcp-types";
import type { ConnectionMetadata } from "@mongodb-js/mcp-atlas-telemetry";
import type { NodeDriverServiceProvider } from "@mongosh/service-provider-node-driver";
import { ErrorCodes, MongoDBError } from "./common/errors.js";
import type { ConnectionEntry, ConnectionRegistry } from "./common/connectionRegistry.js";
import { assertNoServerSideJS, isWriteStage, type WriteStageTarget } from "./helpers/mqlGuards.js";
import { buildWriteStageConfirmationMessage } from "./helpers/writeStageConfirmation.js";
import { EXPORT_TOOL_NAME } from "./helpers/constants.js";
import type { AvailableExport, CreateJSONExportParams } from "./common/exportsManager.js";

export const DBOperationArgs = {
    database: z.string().describe("Database name"),
};

export const CollOperationArgs = {
    ...DBOperationArgs,
    collection: z.string().describe("Collection name"),
};

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

/**
 * The services specifically injected into MongoDB tools (on top of the base
 * `ToolServices`). Injected individually — there is no server-scoped session
 * object.
 */
export type MongoDBToolServices = ToolServices<IMongoDBConfig> & {
    connectionRegistry: ConnectionRegistry;
    connectionErrorHandler(
        error: MongoDBError,
        context: { availableTools: readonly ToolServerTool[]; connectionState: unknown }
    ): Promise<{ errorHandled: boolean; result: CallToolResult }>;
    exportsManager: { createJSONExport: (params: CreateJSONExportParams) => Promise<AvailableExport> };
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

// Shared leaf for the variant advertised when no connection string is configured.
// Precomputed once so the register()-time swap reuses it instead of rebuilding.
const connectionIdArgWithoutPreconfigured = z
    .string()
    .describe(connectionIdDescription({ hasPreconfiguredConnection: false }));

export type MongoDBToolServer = ToolServer<MongoDBToolServices>;

export abstract class MongoDBToolBase extends ToolBase<MongoDBToolServer> {
    static category: ToolCategory = "mongodb";

    protected get isExportToolAvailable(): boolean {
        const registeredTools = this.server.tools;
        const exportTool = registeredTools.find((tool) => tool.name === EXPORT_TOOL_NAME);
        return exportTool?.isEnabled() ?? false;
    }

    /**
     * Resolves the required `connectionId` argument to a live service provider
     * via the app-level connection registry. There is deliberately no implicit
     * "current connection" fallback — see the connection-handles proposal.
     */
    protected async resolveConnection(connectionId: string): Promise<NodeDriverServiceProvider> {
        return this.server.connectionRegistry.resolve(connectionId);
    }

    /** The registry entry for the given connectionId, if it exists. Does not affect LRU ordering. */
    protected async peekConnection(connectionId: string | undefined): Promise<ConnectionEntry | undefined> {
        return connectionId ? this.server.connectionRegistry.peek(connectionId) : undefined;
    }

    protected async isSearchSupported(connectionId: string): Promise<boolean> {
        const entry = await this.server.connectionRegistry.peek(connectionId);
        return entry ? entry.isSearchSupported(this.server.logger as never) : false;
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
     * If `maxTimeMS` is configured in the request's effective config, it will be included
     * in the returned options.
     */
    protected getOperationOptions(request: ToolRequest<IMongoDBConfig>): { signal?: AbortSignal; maxTimeMS?: number } {
        return {
            ...(request.signal && { signal: request.signal }),
            ...(this.server.config.maxTimeMS !== undefined && { maxTimeMS: this.server.config.maxTimeMS }),
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
     *
     * @param config The effective config for the current request — the MQL
     * permission checks (server-side JS, read-only write stages, disabled
     * write operations) are request-dependent.
     */
    protected assertMqlIsAllowed(
        config: IMongoDBConfig,
        ...values: (Record<string, unknown> | Record<string, unknown>[] | undefined)[]
    ): void {
        for (const value of values) {
            this.assertSingleMqlValueIsAllowed(config, value);
        }
    }

    /**
     * Asks the user to confirm the write stages of an aggregation pipeline,
     * throwing when they decline so that the pipeline never runs.
     *
     * Multi-round-trip (protocol revision 2026-07-28): when this round carries
     * no answer yet, returns the `inputRequired` result the handler must
     * return instead of proceeding (null means "continue"). On re-entry the
     * answer is read back from `inputResponses`.
     */
    protected confirmWriteStages(
        targets: WriteStageTarget[],
        context: ToolExecutionContext
    ): InputRequiredResult | null {
        if (this.requiresConfirmation() || !this.server.elicitation.supportsElicitation()) {
            return null;
        }

        const message = buildWriteStageConfirmationMessage(targets);
        const confirmed = this.requestConfirmation(message, context);
        if (confirmed === undefined) {
            return this.server.elicitation.confirmationRequired(message);
        }
        if (!confirmed) {
            throw new MongoDBError(
                ErrorCodes.ConfirmationDeclined,
                "User did not confirm the write stages of the aggregation pipeline so the aggregation was not performed."
            );
        }
        return null;
    }

    private assertSingleMqlValueIsAllowed(
        config: IMongoDBConfig,
        value: Record<string, unknown> | Record<string, unknown>[] | undefined
    ): void {
        if (config.disableServerSideJs) {
            assertNoServerSideJS(value);
        }

        if (Array.isArray(value)) {
            // Only check for forbidden write stages when the value is an array, which indicates it's an
            // aggregation pipeline. Query filters are objects, so they won't be checked for write stages,
            // which is correct since they can't contain them.
            const writeOperations: OperationType[] = ["update", "create", "delete"];

            let writeStageForbiddenErrorMessage = "";
            if (config.readOnly) {
                writeStageForbiddenErrorMessage =
                    "In readOnly mode you can not run pipelines with $out or $merge stages.";
            } else if (config.disabledTools.some((t) => writeOperations.includes(t as OperationType))) {
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

    /**
     * The connectionId description varies by whether a connection string is
     * preconfigured, so cache each variant's shape separately.
     */
    protected override schemaVariantKey(): string {
        if ("connectionId" in this.argsShape) {
            return this.server.config.connectionString ? "preconfigured" : "plain";
        }
        return "";
    }

    public register(): boolean {
        // The default connectionId description advertises the "preconfigured"
        // handle; drop that mention when no connection string is configured.
        if ("connectionId" in this.argsShape && !this.server.config.connectionString) {
            this.argsShape = {
                ...this.argsShape,
                connectionId: connectionIdArgWithoutPreconfigured,
            };
        }
        return super.register();
    }

    protected async handleError(error: unknown, args: ToolArgs<typeof this.argsShape>): Promise<CallToolResult> {
        if (error instanceof MongoDBError) {
            switch (error.code) {
                case ErrorCodes.NotConnectedToMongoDB:
                case ErrorCodes.MisconfiguredConnectionString:
                case ErrorCodes.UnknownConnectionId: {
                    const rawConnectionError = error as MongoDBError<
                        | typeof ErrorCodes.NotConnectedToMongoDB
                        | typeof ErrorCodes.MisconfiguredConnectionString
                        | typeof ErrorCodes.UnknownConnectionId
                    >;
                    // The message may embed a driver error verbatim (e.g. MisconfiguredConnectionString),
                    // which can contain secrets from the connection string; redact before it is
                    // interpolated into any handler's (default or injected) output.
                    const connectionError = new MongoDBError(
                        rawConnectionError.code,
                        this.server.keychain.redact(rawConnectionError.message)
                    );
                    const outcome = await this.server.connectionErrorHandler(connectionError, {
                        availableTools: this.server.tools,
                        connectionState: (await this.peekConnection(args.connectionId as string | undefined))?.state,
                    });
                    if (outcome.errorHandled) {
                        return outcome.result;
                    }

                    return super.handleError(error, args);
                }
                case ErrorCodes.ConfirmationDeclined:
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
                    const CTA = this.server.isToolCategoryAvailable("atlas-local")
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
