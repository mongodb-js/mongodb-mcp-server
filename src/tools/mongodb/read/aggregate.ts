import { z } from "zod";
import type { AggregationCursor } from "mongodb";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { NodeDriverServiceProvider } from "@mongosh/service-provider-node-driver";
import { DbOperationArgs, MongoDBToolBase } from "../mongodbTool.js";
import type { ToolArgs, OperationType, ToolExecutionContext } from "../../tool.js";
import { formatUntrustedData } from "../../tool.js";
import { checkIndexUsage } from "../../../helpers/indexCheck.js";
import { type Document, EJSON } from "bson";
import { ErrorCodes, MongoDBError } from "../../../common/errors.js";
import { collectCursorUntilMaxBytesLimit } from "../../../helpers/collectCursorUntilMaxBytes.js";
import { operationWithFallback } from "../../../helpers/operationWithFallback.js";
import { AGG_COUNT_MAX_TIME_MS_CAP, ONE_MB, CURSOR_LIMITS_TO_LLM_TEXT } from "../../../helpers/constants.js";
import { zEJSON } from "../../args.js";
import { LogId } from "../../../common/logger.js";

export const AggregateArgs = {
    pipeline: z.array(zEJSON()).describe("An array of aggregation stages to execute"),
    responseBytesLimit: z.number().optional().default(ONE_MB).describe(`\
The maximum number of bytes to return in the response. This value is capped by the server’s configured maxBytesPerQuery and cannot be exceeded. \
Note to LLM: If the entire aggregation result is required, use the "export" tool instead of increasing this limit.\
`),
};

export class AggregateTool extends MongoDBToolBase {
    public name = "aggregate";
    protected description = "Run an aggregation against a MongoDB collection";
    protected argsShape = {
        ...DbOperationArgs,
        ...AggregateArgs,
    };
    public operationType: OperationType = "read";

    protected async execute(
        { database, collection, pipeline, responseBytesLimit }: ToolArgs<typeof this.argsShape>,
        { signal }: ToolExecutionContext
    ): Promise<CallToolResult> {
        let aggregationCursor: AggregationCursor | undefined;
        try {
            const provider = await this.ensureConnected();

            this.assertOnlyUsesPermittedStages(pipeline);

            // Check if aggregate operation uses an index if enabled
            if (this.config.indexCheck) {
                await checkIndexUsage(provider, database, collection, "aggregate", async () => {
                    return provider
                        .aggregate(database, collection, pipeline, {}, { writeConcern: undefined })
                        .explain("queryPlanner");
                });
            }

            const cappedResultsPipeline = [...pipeline];
            if (this.config.maxDocumentsPerQuery > 0) {
                cappedResultsPipeline.push({ $limit: this.config.maxDocumentsPerQuery });
            }
            aggregationCursor = provider.aggregate(database, collection, cappedResultsPipeline);

            const [totalDocuments, cursorResults] = await Promise.all([
                this.countAggregationResultDocuments({ provider, database, collection, pipeline }),
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

            return {
                content: formatUntrustedData(
                    this.generateMessage({
                        aggResultsCount: totalDocuments,
                        documents: cursorResults.documents,
                        appliedLimits: [
                            aggregationResultsCappedByMaxDocumentsLimit ? "config.maxDocumentsPerQuery" : undefined,
                            cursorResults.cappedBy,
                        ].filter((limit): limit is keyof typeof CURSOR_LIMITS_TO_LLM_TEXT => !!limit),
                    }),
                    cursorResults.documents.length > 0 ? EJSON.stringify(cursorResults.documents) : undefined
                ),
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
                context: "aggregate tool",
                message: `Error when closing the cursor - ${error instanceof Error ? error.message : String(error)}`,
            });
        }
    }

    private assertOnlyUsesPermittedStages(pipeline: Record<string, unknown>[]): void {
        const writeOperations: OperationType[] = ["update", "create", "delete"];
        let writeStageForbiddenError = "";

        if (this.config.readOnly) {
            writeStageForbiddenError = "In readOnly mode you can not run pipelines with $out or $merge stages.";
        } else if (this.config.disabledTools.some((t) => writeOperations.includes(t as OperationType))) {
            writeStageForbiddenError =
                "When 'create', 'update', or 'delete' operations are disabled, you can not run pipelines with $out or $merge stages.";
        }

        if (!writeStageForbiddenError) {
            return;
        }

        for (const stage of pipeline) {
            if (stage.$out || stage.$merge) {
                throw new MongoDBError(ErrorCodes.ForbiddenWriteOperation, writeStageForbiddenError);
            }
        }
    }

    private async countAggregationResultDocuments({
        provider,
        database,
        collection,
        pipeline,
    }: {
        provider: NodeDriverServiceProvider;
        database: string;
        collection: string;
        pipeline: Document[];
    }): Promise<number | undefined> {
        const resultsCountAggregation = [...pipeline, { $count: "totalDocuments" }];
        return await operationWithFallback(async (): Promise<number | undefined> => {
            const aggregationResults = await provider
                .aggregate(database, collection, resultsCountAggregation)
                .maxTimeMS(AGG_COUNT_MAX_TIME_MS_CAP)
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
        const appliedLimitText = appliedLimits.length
            ? `\
while respecting the applied limits of ${appliedLimits.map((limit) => CURSOR_LIMITS_TO_LLM_TEXT[limit]).join(", ")}. \
Note to LLM: If the entire query result is required then use "export" tool to export the query results.\
`
            : "";

        return `\
The aggregation resulted in ${aggResultsCount === undefined ? "indeterminable number of" : aggResultsCount} documents. \
Returning ${documents.length} documents${appliedLimitText ? ` ${appliedLimitText}` : "."}\
`;
    }
}
