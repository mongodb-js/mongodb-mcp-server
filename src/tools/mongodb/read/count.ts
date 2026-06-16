import { CollOperationArgs, MongoDBToolBase } from "../mongodbTool.js";
import type { ToolArgs, OperationType, ToolExecutionContext, ToolResult } from "../../tool.js";
import { checkIndexUsage } from "../../../helpers/indexCheck.js";
import { zEJSON } from "../../args.js";
import { z } from "zod";

export const CountArgs = {
    query: zEJSON()
        .optional()
        .describe(
            "A filter/query parameter. Allows users to filter the documents to count. Matches the syntax of the filter argument of db.collection.count()."
        ),
};

const CountOutputSchema = {
    count: z.number().optional().describe("The number of documents in the collection"),
};

export class CountTool extends MongoDBToolBase {
    static toolName = "count";
    public description =
        "Gets the number of documents in a MongoDB collection using db.collection.count() and query as an optional filter parameter";
    public argsShape = {
        ...CollOperationArgs,
        ...CountArgs,
    };

    static operationType: OperationType = "read";

    public override outputSchema = CountOutputSchema;

    protected async execute(
        { database, collection, query }: ToolArgs<typeof this.argsShape>,
        { signal }: ToolExecutionContext
    ): Promise<ToolResult<typeof this.outputSchema>> {
        const provider = await this.ensureConnected();

        this.assertMqlIsAllowed(query);

        // Check if count operation uses an index if enabled
        if (this.config.indexCheck) {
            await checkIndexUsage({
                database,
                collection,
                operation: "count",
                explainCallback: async () => {
                    return provider.runCommandWithCheck(
                        database,
                        {
                            explain: {
                                count: collection,
                                query,
                            },
                            verbosity: "queryPlanner",
                            ...(this.config.maxTimeMS !== undefined && { maxTimeMS: this.config.maxTimeMS }),
                        },
                        {
                            signal,
                        }
                    );
                },
                logger: this.session.logger,
            });
        }

        const count = await provider.countDocuments(database, collection, query, {
            ...this.getOperationOptions(signal),
        });

        return {
            content: [
                {
                    text: `Found ${count} documents in the collection "${collection}"${query ? " that matched the query" : ""}.`,
                    type: "text",
                },
            ],
            structuredContent: {
                count,
            },
        };
    }
}
