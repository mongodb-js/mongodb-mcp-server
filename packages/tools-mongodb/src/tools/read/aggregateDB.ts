import { z } from "zod";
import type { AggregationCursor } from "mongodb";
import type { InputRequiredResult } from "@mongodb-js/mcp-core";
import type { NodeDriverServiceProvider } from "@mongosh/service-provider-node-driver";
import { ConnectionIdArgs, DBOperationArgs, MongoDBToolBase, type IMongoDBConfig } from "../../mongodbTool.js";
import type { ToolArgs, ToolResult } from "@mongodb-js/mcp-core";
import type { OperationType, ToolExecutionContext } from "@mongodb-js/mcp-types";
import { formatUntrustedData } from "@mongodb-js/mcp-core";
import { type Document } from "bson";
import { ErrorCodes, MongoDBError } from "../../common/errors.js";
import { collectCursorUntilMaxBytesLimit } from "../../helpers/collectCursorUntilMaxBytes.js";
import { operationWithFallback } from "../../helpers/operationWithFallback.js";
import { getWriteStageTargets } from "../../helpers/mqlGuards.js";
import { ONE_MB, CURSOR_LIMITS_TO_LLM_TEXT, CURSOR_LIMIT_KEYS, type CursorLimitKey } from "../../helpers/constants.js";
import { LogId } from "@mongodb-js/mcp-core";
import { AnyAggregateStage, DB_AGGREGATE_STAGE_OPERATORS } from "../../mongodbSchemas.js";
import { bsonToJson } from "../../helpers/bsonToJson.js";

const AggregateDBOutputSchema = {
    documents: z.array(z.unknown()).describe("The documents returned by the aggregation pipeline"),
    aggResultsCount: z
        .number()
        .optional()
        .describe("The total number of documents returned by the aggregation pipeline"),
    appliedLimits: z.array(CURSOR_LIMIT_KEYS).describe("The limits applied to the aggregation pipeline"),
};

export const AggregateArgs = {
    pipeline: z
        .array(AnyAggregateStage)
        .min(1)
        .describe(
            `An array of aggregation stages to execute. The first stage must be a database-level aggregation stage (one of ${DB_AGGREGATE_STAGE_OPERATORS.map((op) => `\`${op}\``).join(", ")}). https://www.mongodb.com/docs/manual/reference/mql/aggregation-stages/#db.aggregate---stages`
        ),
};

export class AggregateDBTool extends MongoDBToolBase {
    static toolName = "aggregate-db";
    public description = "Run an aggregation against a MongoDB database";
    public argsShape = {
        ...ConnectionIdArgs,
        ...DBOperationArgs,
        ...AggregateArgs,
        responseBytesLimit: z
            .number()
            .optional()
            .default(ONE_MB)
            .describe(
                "The maximum number of bytes to return in the response. This value is capped by the server's configured maximum and cannot be exceeded."
            ),
    };
    static operationType: OperationType = "read";

    public override outputSchema = AggregateDBOutputSchema;

    protected async execute(
        { connectionId, database, pipeline, responseBytesLimit }: ToolArgs<typeof this.argsShape>,
        context: ToolExecutionContext<IMongoDBConfig>
    ): Promise<ToolResult<typeof this.outputSchema> | InputRequiredResult> {
        const { request } = context;
        let aggregationCursor: AggregationCursor | undefined = undefined;
        try {
            const provider = await this.resolveConnection(connectionId);
            this.assertOnlyUsesPermittedStages(request.config, pipeline);

            let successMessage: string;
            let documents: unknown[];
            let aggResultsCount: number | undefined;
            let appliedLimits: CursorLimitKey[] = [];

            const writeStageTargets = getWriteStageTargets(pipeline, database);
            if (writeStageTargets.length > 0) {
                const writeConfirmation = this.confirmWriteStages(writeStageTargets, context);
                if (writeConfirmation) {
                    return writeConfirmation;
                }

                // This is a write pipeline, so special-case it and don't attempt to apply limits or caps
                aggregationCursor = provider.aggregateDb(database, pipeline, {
                    ...this.getOperationOptions(request),
                });

                documents = await aggregationCursor.toArray();
                successMessage = "The aggregation pipeline executed successfully.";
            } else {
                const cappedResultsPipeline = [...pipeline];
                if (request.config.maxDocumentsPerQuery > 0) {
                    cappedResultsPipeline.push({ $limit: request.config.maxDocumentsPerQuery });
                }
                aggregationCursor = provider.aggregateDb(database, cappedResultsPipeline, {
                    ...this.getOperationOptions(request),
                });

                const [totalDocuments, cursorResults] = await Promise.all([
                    this.countAggregationResultDocuments(request.config, {
                        provider,
                        database,
                        pipeline,
                        abortSignal: request.signal,
                    }),
                    collectCursorUntilMaxBytesLimit({
                        cursor: aggregationCursor,
                        configuredMaxBytesPerQuery: request.config.maxBytesPerQuery,
                        toolResponseBytesLimit: responseBytesLimit,
                        abortSignal: request.signal,
                    }),
                ]);

                // If the total number of documents that the aggregation would've
                // resulted in would be greater than the configured
                // maxDocumentsPerQuery then we know for sure that the results were
                // capped.
                const aggregationResultsCappedByMaxDocumentsLimit =
                    request.config.maxDocumentsPerQuery > 0 &&
                    !!totalDocuments &&
                    totalDocuments > request.config.maxDocumentsPerQuery;

                documents = bsonToJson(cursorResults.documents);
                aggResultsCount = totalDocuments;
                appliedLimits = [
                    aggregationResultsCappedByMaxDocumentsLimit ? "config.maxDocumentsPerQuery" : undefined,
                    cursorResults.cappedBy,
                ].filter((limit): limit is CursorLimitKey => !!limit);
                successMessage = this.generateMessage({
                    aggResultsCount,
                    documents,
                    appliedLimits,
                });
            }

            return {
                content: formatUntrustedData(
                    successMessage,
                    ...(documents.length > 0 ? [JSON.stringify(documents)] : [])
                ),
                structuredContent: {
                    documents,
                    ...(aggResultsCount !== undefined ? { aggResultsCount } : {}),
                    appliedLimits,
                },
            };
        } finally {
            if (aggregationCursor) {
                void this.safeCloseCursor(aggregationCursor);
            }
        }
    }

    private async safeCloseCursor(cursor: AggregationCursor<unknown>): Promise<void> {
        try {
            await cursor.close();
        } catch (error) {
            this.server.logger.warning({
                id: LogId.mongodbCursorCloseError,
                context: "aggregate-db tool",
                message: `Error when closing the cursor - ${error instanceof Error ? error.message : String(error)}`,
            });
        }
    }

    private assertOnlyUsesPermittedStages(config: IMongoDBConfig, pipeline: Record<string, unknown>[]): void {
        const firstStage = pipeline[0];
        if (!firstStage || !DB_AGGREGATE_STAGE_OPERATORS.some((op) => op in firstStage)) {
            throw new MongoDBError(
                ErrorCodes.InvalidPipeline,
                `The first stage of the pipeline must be a database-level aggregation stage (one of ${DB_AGGREGATE_STAGE_OPERATORS.join(", ")})`
            );
        }

        this.assertMqlIsAllowed(config, pipeline);
    }

    private async countAggregationResultDocuments(
        config: IMongoDBConfig,
        {
            provider,
            database,
            pipeline,
            abortSignal,
        }: {
            provider: NodeDriverServiceProvider;
            database: string;
            pipeline: Document[];
            abortSignal?: AbortSignal;
        }
    ): Promise<number | undefined> {
        const resultsCountAggregation = [...pipeline, { $count: "totalDocuments" }];
        return await operationWithFallback(async (): Promise<number | undefined> => {
            const aggregationResults = await provider
                .aggregateDb(database, resultsCountAggregation, {
                    signal: abortSignal,
                })
                .maxTimeMS(
                    config.maxTimeMS !== undefined
                        ? Math.min(config.maxTimeMS, config.aggregationCountMaxTimeMsCap)
                        : config.aggregationCountMaxTimeMsCap
                )
                .toArray();

            const documentWithCount: unknown = aggregationResults.length === 1 ? aggregationResults[0] : undefined;
            const totalDocuments =
                documentWithCount &&
                typeof documentWithCount === "object" &&
                "totalDocuments" in documentWithCount &&
                typeof documentWithCount.totalDocuments === "number"
                    ? documentWithCount.totalDocuments
                    : 0;

            return totalDocuments;
        }, undefined);
    }

    private generateMessage({
        aggResultsCount,
        documents,
        appliedLimits,
    }: {
        aggResultsCount: number | undefined;
        documents: unknown[];
        appliedLimits: CursorLimitKey[];
    }): string {
        let message = `The aggregation resulted in ${aggResultsCount === undefined ? "indeterminable number of" : aggResultsCount} documents.`;

        // If we applied a limit or the count is different from the aggregation result count,
        // communicate what is the actual number of returned documents
        if (documents.length !== aggResultsCount || appliedLimits.length) {
            message += ` Returning ${documents.length} documents`;
            if (appliedLimits.length) {
                message += ` while respecting the applied limits of ${appliedLimits
                    .map((limit) => CURSOR_LIMITS_TO_LLM_TEXT[limit])
                    .join(", ")}`;
            }

            message += ".";
        }

        return message;
    }
}
