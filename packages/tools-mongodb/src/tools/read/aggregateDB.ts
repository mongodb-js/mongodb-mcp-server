import { z } from "zod";
import type { AggregationCursor } from "mongodb";
import type { CallToolResult } from "@mongodb-js/mcp-types";
import type { NodeDriverServiceProvider } from "@mongosh/service-provider-node-driver";
import { DBOperationArgs, MongoDBToolBase } from "../../mongodbTool.js";
import type { ToolArgs } from "@mongodb-js/mcp-core";
import type { OperationType, ToolExecutionContext } from "@mongodb-js/mcp-types";
import { formatUntrustedData } from "@mongodb-js/mcp-core";
import { type Document, EJSON } from "bson";
import { ErrorCodes, MongoDBError } from "../../common/errors.js";
import { collectCursorUntilMaxBytesLimit } from "../../helpers/collectCursorUntilMaxBytes.js";
import { operationWithFallback } from "../../helpers/operationWithFallback.js";
import { LogId } from "@mongodb-js/mcp-core";
import { ONE_MB, CURSOR_LIMITS_TO_LLM_TEXT } from "../../helpers/constants.js";
import { bsonToJson } from "../../helpers/bsonToJson.js";
import { AnyAggregateStage, DB_AGGREGATE_STAGE_OPERATORS } from "../../mongodbSchemas.js";

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
        ...DBOperationArgs,
        ...AggregateArgs,
        responseBytesLimit: z.number().optional().default(ONE_MB).describe(`\
The maximum number of bytes to return in the response. This value is capped by the server's configured maxBytesPerQuery and cannot be exceeded.`),
    };
    static operationType: OperationType = "read";

    protected async execute(
        { database, pipeline, responseBytesLimit }: ToolArgs<typeof this.argsShape>,
        { signal }: ToolExecutionContext
    ): Promise<CallToolResult> {
        let aggregationCursor: AggregationCursor | undefined = undefined;
        let documents: unknown[] = [];
        let aggResultsCount: number | undefined;
        let appliedLimits: (keyof typeof CURSOR_LIMITS_TO_LLM_TEXT)[] = [];
        let successMessage: string;

        try {
            const provider = await this.ensureConnected();
            this.assertOnlyUsesPermittedStages(pipeline);

            if (pipeline.some((stage) => this.isWriteStage(stage))) {
                // This is a write pipeline, so special-case it and don't attempt to apply limits or caps
                aggregationCursor = provider.aggregateDb(database, pipeline, {
                    ...this.getOperationOptions(signal),
                });

                documents = await aggregationCursor.toArray();
                successMessage = "The aggregation pipeline executed successfully.";
            } else {
                const cappedResultsPipeline = [...pipeline];
                if (this.config.maxDocumentsPerQuery > 0) {
                    cappedResultsPipeline.push({ $limit: this.config.maxDocumentsPerQuery });
                }
                aggregationCursor = provider.aggregateDb(database, cappedResultsPipeline, {
                    ...this.getOperationOptions(signal),
                });

                const [totalDocuments, cursorResults] = await Promise.all([
                    this.countAggregationResultDocuments({
                        provider,
                        database,
                        pipeline,
                        abortSignal: signal,
                    }),
                    collectCursorUntilMaxBytesLimit({
                        cursor: aggregationCursor,
                        configuredMaxBytesPerQuery: this.config.maxBytesPerQuery,
                        toolResponseBytesLimit: responseBytesLimit,
                        abortSignal: signal,
                    }),
                ]);

                // If the total number of documents that the aggregation would've
                // resulted in would be greater than the configured
                // maxDocumentsPerQuery then we know for sure that the results were
                // capped.
                const aggregationResultsCappedByMaxDocumentsLimit =
                    this.config.maxDocumentsPerQuery > 0 &&
                    !!totalDocuments &&
                    totalDocuments > this.config.maxDocumentsPerQuery;

                documents = cursorResults.documents;
                aggResultsCount = totalDocuments;
                appliedLimits = [
                    aggregationResultsCappedByMaxDocumentsLimit ? "config.maxDocumentsPerQuery" : undefined,
                    cursorResults.cappedBy,
                ].filter((limit): limit is keyof typeof CURSOR_LIMITS_TO_LLM_TEXT => !!limit);

                successMessage = this.generateMessage({
                    aggResultsCount: totalDocuments,
                    documents: cursorResults.documents,
                    appliedLimits,
                });
            }

            return {
                content: formatUntrustedData(
                    successMessage,
                    ...(documents.length > 0 ? [EJSON.stringify(documents)] : [])
                ),
                structuredContent: {
                    documents: bsonToJson(documents),
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
            this.session.logger.warning({
                id: LogId.mongodbCursorCloseError,
                context: "aggregate-db tool",
                message: `Error when closing the cursor - ${error instanceof Error ? error.message : String(error)}`,
            });
        }
    }

    private assertOnlyUsesPermittedStages(pipeline: Record<string, unknown>[]): void {
        const firstStage = pipeline[0];
        if (!firstStage || !DB_AGGREGATE_STAGE_OPERATORS.some((op) => op in firstStage)) {
            throw new MongoDBError(
                ErrorCodes.InvalidPipeline,
                `The first stage of the pipeline must be a database-level aggregation stage (one of ${DB_AGGREGATE_STAGE_OPERATORS.join(", ")})`
            );
        }

        this.assertMqlIsAllowed(pipeline);
    }

    private async countAggregationResultDocuments({
        provider,
        database,
        pipeline,
        abortSignal,
    }: {
        provider: NodeDriverServiceProvider;
        database: string;
        pipeline: Document[];
        abortSignal?: AbortSignal;
    }): Promise<number | undefined> {
        const resultsCountAggregation = [...pipeline, { $count: "totalDocuments" }];
        return await operationWithFallback(async (): Promise<number | undefined> => {
            const aggregationResults = await provider
                .aggregateDb(database, resultsCountAggregation, {
                    signal: abortSignal,
                })
                .maxTimeMS(this.getAggregationCountDocumentsMaxTimeMS())
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
        appliedLimits: (keyof typeof CURSOR_LIMITS_TO_LLM_TEXT)[];
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

    private isWriteStage(stage: Record<string, unknown>): boolean {
        return "$out" in stage || "$merge" in stage;
    }
}
