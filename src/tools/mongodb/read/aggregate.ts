import { z } from "zod";
import type { AggregationCursor } from "mongodb";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { NodeDriverServiceProvider } from "@mongosh/service-provider-node-driver";
import { DbOperationArgs, MongoDBToolBase } from "../mongodbTool.js";
import type { ToolArgs, OperationType } from "../../tool.js";
import { formatUntrustedData } from "../../tool.js";
import { checkIndexUsage } from "../../../helpers/indexCheck.js";
import { type Document, EJSON } from "bson";
import { ErrorCodes, MongoDBError } from "../../../common/errors.js";
import { iterateCursorUntilMaxBytes } from "../../../helpers/iterateCursor.js";
import { operationWithFallback } from "../../../helpers/operationWithFallback.js";

/**
 * A cap for the maxTimeMS used for counting resulting documents of an
 * aggregation.
 */
const AGG_COUNT_MAX_TIME_MS_CAP = 60_000;

export const AggregateArgs = {
    pipeline: z.array(z.object({}).passthrough()).describe("An array of aggregation stages to execute"),
};

export class AggregateTool extends MongoDBToolBase {
    public name = "aggregate";
    protected description = "Run an aggregation against a MongoDB collection";
    protected argsShape = {
        ...DbOperationArgs,
        ...AggregateArgs,
    };
    public operationType: OperationType = "read";

    protected async execute({
        database,
        collection,
        pipeline,
    }: ToolArgs<typeof this.argsShape>): Promise<CallToolResult> {
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

            const cappedResultsPipeline = [...pipeline, { $limit: this.config.maxDocumentsPerQuery }];
            aggregationCursor = provider
                .aggregate(database, collection, cappedResultsPipeline)
                .batchSize(this.config.maxDocumentsPerQuery);

            const [totalDocuments, documents] = await Promise.all([
                this.countAggregationResultDocuments({ provider, database, collection, pipeline }),
                iterateCursorUntilMaxBytes(aggregationCursor, this.config.maxBytesPerQuery),
            ]);

            let messageDescription = `\
The aggregation resulted in ${totalDocuments === undefined ? "indeterminable number of" : totalDocuments} documents.\
`;
            if (documents.length) {
                messageDescription += ` \
Returning ${documents.length} documents while respecting the applied limits. \
Note to LLM: If entire aggregation result is needed then use "export" tool to export the aggregation results.\
`;
            }

            return {
                content: formatUntrustedData(
                    messageDescription,
                    documents.length > 0 ? EJSON.stringify(documents) : undefined
                ),
            };
        } finally {
            await aggregationCursor?.close();
        }
    }

    private assertOnlyUsesPermittedStages(pipeline: Record<string, unknown>[]): void {
        if (!this.config.readOnly) {
            return;
        }

        for (const stage of pipeline) {
            if (stage.$out || stage.$merge) {
                throw new MongoDBError(
                    ErrorCodes.ForbiddenWriteOperation,
                    "In readOnly mode you can not run pipelines with $out or $merge stages."
                );
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
}
