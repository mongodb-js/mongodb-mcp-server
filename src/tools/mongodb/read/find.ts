import { z } from "zod";
import { CollOperationArgs, ConnectionIdArgs, MongoDBToolBase } from "../mongodbTool.js";
import type { ToolArgs, OperationType, ToolExecutionContext, ToolResult } from "../../tool.js";
import { formatUntrustedData } from "../../tool.js";
import type { FindCursor } from "mongodb";
import { checkIndexUsage } from "../../../helpers/indexCheck.js";
import { collectCursorUntilMaxBytesLimit } from "../../../helpers/collectCursorUntilMaxBytes.js";
import { operationWithFallback } from "../../../helpers/operationWithFallback.js";
import {
    ONE_MB,
    QUERY_COUNT_MAX_TIME_MS_CAP,
    CURSOR_LIMITS_TO_LLM_TEXT,
    CURSOR_LIMIT_KEYS,
    type CursorLimitKey,
} from "../../../helpers/constants.js";
import { zEJSON } from "../../args.js";
import { LogId } from "../../../common/logging/index.js";
import { SortDirectionSchema } from "../mongodbSchemas.js";
import { bsonToJson } from "../../../helpers/bsonToJson.js";

export const FindArgs = {
    filter: zEJSON()
        .optional()
        .describe("The query filter, matching the syntax of the query argument of db.collection.find()"),
    projection: z
        .object({})
        .passthrough()
        .optional()
        .describe("The projection, matching the syntax of the projection argument of db.collection.find()"),
    limit: z.number().optional().default(10).describe("The maximum number of documents to return"),
    sort: z
        .record(z.string(), SortDirectionSchema.describe("The sort key and its direction"))
        .optional()
        .describe(
            "A document, describing the sort order, matching the syntax of the sort argument of cursor.sort(). The keys of the object are the fields to sort on, while the values are the sort directions (1 for ascending, -1 for descending)."
        ),
};

export const FindOutputSchema = {
    documents: z.array(z.unknown()).describe("The documents returned by the find query"),
    queryResultsCount: z.number().optional().describe("The total number of documents returned by the find query"),
    appliedLimits: z.array(CURSOR_LIMIT_KEYS).describe("The limits applied to the find query"),
};

export class FindTool extends MongoDBToolBase {
    static toolName = "find";
    public description = "Run a find query against a MongoDB collection";
    public argsShape = {
        ...ConnectionIdArgs,
        ...CollOperationArgs,
        ...FindArgs,
        responseBytesLimit: z
            .number()
            .optional()
            .default(ONE_MB)
            .describe(
                "The maximum number of bytes to return in the response. This value is capped by the server's configured maximum and cannot be exceeded."
            ),
    };
    static operationType: OperationType = "read";

    public override outputSchema = FindOutputSchema;

    protected async execute(
        {
            connectionId,
            database,
            collection,
            filter,
            projection,
            limit,
            sort,
            responseBytesLimit,
        }: ToolArgs<typeof this.argsShape>,
        { signal }: ToolExecutionContext
    ): Promise<ToolResult<typeof this.outputSchema>> {
        let findCursor: FindCursor<unknown> | undefined = undefined;
        try {
            const provider = await this.resolveConnection(connectionId);

            this.assertMqlIsAllowed(filter, projection);

            // Check if find operation uses an index if enabled
            if (this.config.indexCheck) {
                await checkIndexUsage({
                    database,
                    collection,
                    operation: "find",
                    explainCallback: async () => {
                        return provider
                            .find(database, collection, filter, {
                                projection,
                                limit,
                                sort,
                                ...this.getOperationOptions(signal),
                            })
                            .explain("queryPlanner");
                    },
                    logger: this.session.logger,
                });
            }

            const limitOnFindCursor = this.getLimitForFindCursor(limit);

            findCursor = provider.find(database, collection, filter, {
                projection,
                limit: limitOnFindCursor.limit,
                sort,
                ...this.getOperationOptions(signal),
            });

            const [queryResultsCount, cursorResults] = await Promise.all([
                operationWithFallback(
                    () =>
                        provider.countDocuments(database, collection, filter, {
                            // We should be counting documents that the original
                            // query would have yielded which is why we don't
                            // use `limitOnFindCursor` calculated above, and
                            // we don't use the limit provided to the tool either.
                            maxTimeMS:
                                this.config.maxTimeMS !== undefined
                                    ? Math.min(this.config.maxTimeMS, QUERY_COUNT_MAX_TIME_MS_CAP)
                                    : QUERY_COUNT_MAX_TIME_MS_CAP,
                            signal,
                        }),
                    undefined
                ),
                collectCursorUntilMaxBytesLimit({
                    cursor: findCursor,
                    configuredMaxBytesPerQuery: this.config.maxBytesPerQuery,
                    toolResponseBytesLimit: responseBytesLimit,
                    abortSignal: signal,
                }),
            ]);

            const serializedDocuments = bsonToJson(cursorResults.documents);
            const appliedLimits = [limitOnFindCursor.cappedBy, cursorResults.cappedBy].filter(
                (limit): limit is CursorLimitKey => !!limit
            );

            return {
                content: formatUntrustedData(
                    this.generateMessage({
                        collection,
                        queryResultsCount,
                        documents: serializedDocuments,
                        appliedLimits,
                    }),
                    ...(serializedDocuments.length > 0 ? [JSON.stringify(serializedDocuments)] : [])
                ),
                structuredContent: {
                    documents: serializedDocuments,
                    ...(queryResultsCount !== undefined ? { queryResultsCount } : {}),
                    appliedLimits,
                },
            };
        } finally {
            if (findCursor) {
                void this.safeCloseCursor(findCursor);
            }
        }
    }

    private async safeCloseCursor(cursor: FindCursor<unknown>): Promise<void> {
        try {
            await cursor.close();
        } catch (error) {
            this.session.logger.warning({
                id: LogId.mongodbCursorCloseError,
                context: "find tool",
                message: `Error when closing the cursor - ${error instanceof Error ? error.message : String(error)}`,
            });
        }
    }

    private generateMessage({
        collection,
        queryResultsCount,
        documents,
        appliedLimits,
    }: {
        collection: string;
        queryResultsCount: number | undefined;
        documents: unknown[];
        appliedLimits: CursorLimitKey[];
    }): string {
        let appliedLimitsText = "";
        if (appliedLimits.length) {
            appliedLimitsText = ` while respecting the applied limits of ${appliedLimits
                .map((limit) => CURSOR_LIMITS_TO_LLM_TEXT[limit])
                .join(", ")}.`;
            if (this.isExportToolAvailable) {
                appliedLimitsText += ` If the entire query result is required, use the "export" tool to retrieve the full result set.`;
            }
        }

        return `\
Query on collection "${collection}" resulted in ${queryResultsCount === undefined ? "indeterminable number of" : queryResultsCount} documents. \
Returning ${documents.length} documents${appliedLimitsText || "."}\
`;
    }

    private getLimitForFindCursor(providedLimit: number | undefined | null): {
        cappedBy: "config.maxDocumentsPerQuery" | undefined;
        limit: number | undefined;
    } {
        const configuredLimit: number = parseInt(String(this.config.maxDocumentsPerQuery), 10);

        // Setting configured maxDocumentsPerQuery to negative, zero or nullish
        // is equivalent to disabling the max limit applied on documents
        const configuredLimitIsNotApplicable = Number.isNaN(configuredLimit) || configuredLimit <= 0;
        if (configuredLimitIsNotApplicable) {
            return { cappedBy: undefined, limit: providedLimit ?? undefined };
        }

        const providedLimitIsNotApplicable = providedLimit === null || providedLimit === undefined;
        if (providedLimitIsNotApplicable) {
            return { cappedBy: "config.maxDocumentsPerQuery", limit: configuredLimit };
        }

        return {
            cappedBy: configuredLimit < providedLimit ? "config.maxDocumentsPerQuery" : undefined,
            limit: Math.min(providedLimit, configuredLimit),
        };
    }
}
