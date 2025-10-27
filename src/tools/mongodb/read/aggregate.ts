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
import { zSupportedEmbeddingParameters } from "../../../common/search/embeddingsProvider.js";
import { collectFieldsFromVectorSearchFilter } from "../../../helpers/collectFieldsFromVectorSearchFilter.js";

const AnyStage = zEJSON();
const VectorSearchStage = z.object({
    $vectorSearch: z
        .object({
            exact: z
                .boolean()
                .optional()
                .default(false)
                .describe(
                    "When true, uses an ENN algorithm, otherwise uses ANN. Using ENN is not compatible with numCandidates, in that case, numCandidates must be left empty."
                ),
            index: z.string().describe("Name of the index, as retrieved from the `collection-indexes` tool."),
            path: z
                .string()
                .describe(
                    "Field, in dot notation, where to search. There must be a vector search index for that field. Note to LLM: When unsure, use the 'collection-indexes' tool to validate that the field is indexed with a vector search index."
                ),
            queryVector: z
                .union([z.string(), z.array(z.number())])
                .describe(
                    "The content to search for. The embeddingParameters field is mandatory if the queryVector is a string, in that case, the tool generates the embedding automatically using the provided configuration."
                ),
            numCandidates: z
                .number()
                .int()
                .positive()
                .optional()
                .describe("Number of candidates for the ANN algorithm. Mandatory when exact is false."),
            limit: z.number().int().positive().optional().default(10),
            filter: zEJSON()
                .optional()
                .describe(
                    "MQL filter that can only use filter fields from the index definition. Note to LLM: If unsure, use the `collection-indexes` tool to learn which fields can be used for filtering."
                ),
            embeddingParameters: zSupportedEmbeddingParameters
                .optional()
                .describe(
                    "The embedding model and its parameters to use to generate embeddings before searching. It is mandatory if queryVector is a string value. Note to LLM: If unsure, ask the user before providing one."
                ),
        })
        .passthrough(),
});

export const AggregateArgs = {
    pipeline: z.array(z.union([AnyStage, VectorSearchStage])).describe(
        `An array of aggregation stages to execute.  
\`$vectorSearch\` **MUST** be the first stage of the pipeline, or the first stage of a \`$unionWith\` subpipeline.
### Usage Rules for \`$vectorSearch\`
- **Unset embeddings:**  
  Unless the user explicitly requests the embeddings, add an \`$unset\` stage **at the end of the pipeline** to remove the embedding field and avoid context limits. **The $unset stage in this situation is mandatory**.
- **Pre-filtering:**
If the user requests additional filtering, include filters in \`$vectorSearch.filter\` only for pre-filter fields in the vector index.
    NEVER include fields in $vectorSearch.filter that are not part of the vector index.
- **Post-filtering:**
    For all remaining filters, add a $match stage after $vectorSearch.
### Note to LLM
- If unsure which fields are filterable, use the collection-indexes tool to determine valid prefilter fields.
- If no requested filters are valid prefilters, omit the filter key from $vectorSearch.`
    ),
    responseBytesLimit: z.number().optional().default(ONE_MB).describe(`\
The maximum number of bytes to return in the response. This value is capped by the server's configured maxBytesPerQuery and cannot be exceeded. \
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
        let aggregationCursor: AggregationCursor | undefined = undefined;
        try {
            const provider = await this.ensureConnected();
            await this.assertOnlyUsesPermittedStages(pipeline);
            await this.assertVectorSearchFilterFieldsAreIndexed(database, collection, pipeline);

            // Check if aggregate operation uses an index if enabled
            if (this.config.indexCheck) {
                await checkIndexUsage(provider, database, collection, "aggregate", async () => {
                    return provider
                        .aggregate(database, collection, pipeline, {}, { writeConcern: undefined })
                        .explain("queryPlanner");
                });
            }

            pipeline = await this.replaceRawValuesWithEmbeddingsIfNecessary({
                database,
                collection,
                pipeline,
            });

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
                    ...(cursorResults.documents.length > 0 ? [EJSON.stringify(cursorResults.documents)] : [])
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

    private async assertOnlyUsesPermittedStages(pipeline: Record<string, unknown>[]): Promise<void> {
        const writeOperations: OperationType[] = ["update", "create", "delete"];
        const isSearchSupported = await this.session.isSearchSupported();

        let writeStageForbiddenError = "";

        if (this.config.readOnly) {
            writeStageForbiddenError = "In readOnly mode you can not run pipelines with $out or $merge stages.";
        } else if (this.config.disabledTools.some((t) => writeOperations.includes(t as OperationType))) {
            writeStageForbiddenError =
                "When 'create', 'update', or 'delete' operations are disabled, you can not run pipelines with $out or $merge stages.";
        }

        for (const stage of pipeline) {
            // This validates that in readOnly mode or "write" operations are disabled, we can't use $out or $merge.
            // This is really important because aggregates are the only "multi-faceted" tool in the MQL, where you
            // can both read and write.
            if ((stage.$out || stage.$merge) && writeStageForbiddenError) {
                throw new MongoDBError(ErrorCodes.ForbiddenWriteOperation, writeStageForbiddenError);
            }

            // This ensure that you can't use $vectorSearch if the cluster does not support MongoDB Search
            // either in Atlas or in a local cluster.
            if (stage.$vectorSearch && !isSearchSupported) {
                throw new MongoDBError(
                    ErrorCodes.AtlasSearchNotSupported,
                    "Atlas Search is not supported in this cluster."
                );
            }
        }
    }

    private async assertVectorSearchFilterFieldsAreIndexed(
        database: string,
        collection: string,
        pipeline: Record<string, unknown>[]
    ): Promise<void> {
        if (!(await this.session.isSearchSupported())) {
            return;
        }

        const searchIndexesWithFilterFields = await this.searchIndexesWithFilterFields(database, collection);
        for (const stage of pipeline) {
            if ("$vectorSearch" in stage) {
                const { $vectorSearch: vectorSearchStage } = stage as z.infer<typeof VectorSearchStage>;
                const allowedFilterFields = searchIndexesWithFilterFields[vectorSearchStage.index];
                if (!allowedFilterFields) {
                    this.session.logger.warning({
                        id: LogId.toolValidationError,
                        context: "aggregate tool",
                        message: `Could not assert if filter fields are indexed - No filter fields found for index ${vectorSearchStage.index}`,
                    });
                    return;
                }

                const filterFieldsInStage = collectFieldsFromVectorSearchFilter(vectorSearchStage.filter);
                const filterFieldsNotIndexed = filterFieldsInStage.filter(
                    (field) => !allowedFilterFields.includes(field)
                );
                if (filterFieldsNotIndexed.length) {
                    throw new MongoDBError(
                        ErrorCodes.AtlasVectorSearchInvalidQuery,
                        `Vector search stage contains filter on fields are not indexed by index ${vectorSearchStage.index} - ${filterFieldsNotIndexed.join(", ")}`
                    );
                }
            }
        }
    }

    private async searchIndexesWithFilterFields(
        database: string,
        collection: string
    ): Promise<Record<string, string[]>> {
        const searchIndexes = (await this.session.serviceProvider.getSearchIndexes(database, collection)) as Array<{
            name: string;
            latestDefinition: {
                fields: Array<
                    | {
                          type: "vector";
                      }
                    | {
                          type: "filter";
                          path: string;
                      }
                >;
            };
        }>;

        return searchIndexes.reduce<Record<string, string[]>>((indexFieldMap, searchIndex) => {
            const filterFields = searchIndex.latestDefinition.fields
                .map<string | undefined>((field) => {
                    return field.type === "filter" ? field.path : undefined;
                })
                .filter((filterField) => filterField !== undefined);

            indexFieldMap[searchIndex.name] = filterFields;
            return indexFieldMap;
        }, {});
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

    private async replaceRawValuesWithEmbeddingsIfNecessary({
        database,
        collection,
        pipeline,
    }: {
        database: string;
        collection: string;
        pipeline: Document[];
    }): Promise<Document[]> {
        for (const stage of pipeline) {
            if ("$vectorSearch" in stage) {
                const { $vectorSearch: vectorSearchStage } = stage as z.infer<typeof VectorSearchStage>;

                if (Array.isArray(vectorSearchStage.queryVector)) {
                    continue;
                }

                if (!vectorSearchStage.embeddingParameters) {
                    throw new MongoDBError(
                        ErrorCodes.AtlasVectorSearchInvalidQuery,
                        "embeddingModel is mandatory if queryVector is a raw string."
                    );
                }

                const embeddingParameters = vectorSearchStage.embeddingParameters;
                delete vectorSearchStage.embeddingParameters;

                const [embeddings] = await this.session.vectorSearchEmbeddingsManager.generateEmbeddings({
                    database,
                    collection,
                    path: vectorSearchStage.path,
                    rawValues: [vectorSearchStage.queryVector],
                    embeddingParameters,
                    inputType: "query",
                });

                // $vectorSearch.queryVector can be a BSON.Binary: that it's not either number or an array.
                // It's not exactly valid from the LLM perspective (they can't provide binaries).
                // That's why we overwrite the stage in an untyped way, as what we expose and what LLMs can use is different.
                vectorSearchStage.queryVector = embeddings as number[];
            }
        }

        return pipeline;
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
