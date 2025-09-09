import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { DbOperationArgs, MongoDBToolBase } from "../mongodbTool.js";
import type { ToolArgs, OperationType } from "../../tool.js";
import { formatUntrustedData } from "../../tool.js";
import type { FindCursor, SortDirection } from "mongodb";
import { checkIndexUsage } from "../../../helpers/indexCheck.js";
import { EJSON } from "bson";
import { iterateCursorUntilMaxBytes } from "../../../helpers/iterateCursor.js";
import { operationWithFallback } from "../../../helpers/operationWithFallback.js";

/**
 * A cap for the maxTimeMS used for FindCursor.countDocuments.
 *
 * The number is relatively smaller because we expect the count documents query
 * to be finished sooner if not by the time the batch of documents is retrieved
 * so that count documents query don't hold the final response back.
 */
const QUERY_COUNT_MAX_TIME_MS_CAP = 10_000;

export const FindArgs = {
    filter: z
        .object({})
        .passthrough()
        .optional()
        .describe("The query filter, matching the syntax of the query argument of db.collection.find()"),
    projection: z
        .object({})
        .passthrough()
        .optional()
        .describe("The projection, matching the syntax of the projection argument of db.collection.find()"),
    limit: z.number().optional().default(10).describe("The maximum number of documents to return"),
    sort: z
        .object({})
        .catchall(z.custom<SortDirection>())
        .optional()
        .describe(
            "A document, describing the sort order, matching the syntax of the sort argument of cursor.sort(). The keys of the object are the fields to sort on, while the values are the sort directions (1 for ascending, -1 for descending)."
        ),
};

export class FindTool extends MongoDBToolBase {
    public name = "find";
    protected description = "Run a find query against a MongoDB collection";
    protected argsShape = {
        ...DbOperationArgs,
        ...FindArgs,
    };
    public operationType: OperationType = "read";

    protected async execute({
        database,
        collection,
        filter,
        projection,
        limit,
        sort,
    }: ToolArgs<typeof this.argsShape>): Promise<CallToolResult> {
        let findCursor: FindCursor<unknown> | undefined;
        try {
            const provider = await this.ensureConnected();

            // Check if find operation uses an index if enabled
            if (this.config.indexCheck) {
                await checkIndexUsage(provider, database, collection, "find", async () => {
                    return provider
                        .find(database, collection, filter, { projection, limit, sort })
                        .explain("queryPlanner");
                });
            }

            const appliedLimit = Math.min(limit, this.config.maxDocumentsPerQuery);
            findCursor = provider.find(database, collection, filter, {
                projection,
                limit: appliedLimit,
                sort,
                batchSize: appliedLimit,
            });

            const [queryResultsCount, documents] = await Promise.all([
                operationWithFallback(
                    () =>
                        provider.countDocuments(database, collection, filter, {
                            limit,
                            maxTimeMS: QUERY_COUNT_MAX_TIME_MS_CAP,
                        }),
                    undefined
                ),
                iterateCursorUntilMaxBytes(findCursor, this.config.maxBytesPerQuery),
            ]);

            let messageDescription = `\
Query on collection "${collection}" resulted in ${queryResultsCount === undefined ? "indeterminable number of" : queryResultsCount} documents.\
`;
            if (documents.length) {
                messageDescription += ` \
Returning ${documents.length} documents while respecting the applied limits. \
Note to LLM: If entire query result is needed then use "export" tool to export the query results.\
`;
            }

            return {
                content: formatUntrustedData(
                    messageDescription,
                    documents.length > 0 ? EJSON.stringify(documents) : undefined
                ),
            };
        } finally {
            await findCursor?.close();
        }
    }
}
