import { CollOperationArgs, connectionScopedArgsShape, MongoDBToolBase } from "../../mongodbTool.js";
import type { ToolArgs, ToolResult } from "@mongodb-js/mcp-core";
import type { OperationType, ToolExecutionContext } from "@mongodb-js/mcp-types";
import type { IMongoDBConfig } from "../../mongodbTool.js";
import { checkIndexUsage } from "../../helpers/indexCheck.js";
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
    count: z.number().describe("The number of documents in the collection"),
};

const CountArgsShapeVariants = connectionScopedArgsShape({
    ...CollOperationArgs,
    ...CountArgs,
});

export class CountTool extends MongoDBToolBase {
    static toolName = "count";
    public description =
        "Gets the number of documents in a MongoDB collection using db.collection.count() and query as an optional filter parameter";
    public argsShape(): typeof CountArgsShapeVariants.preconfigured {
        return this.selectConnectionScopedArgsShape(CountArgsShapeVariants);
    }

    static operationType: OperationType = "read";

    public override outputSchema(): typeof CountOutputSchema {
        return CountOutputSchema;
    }

    protected async execute(
        { connectionId, database, collection, query }: ToolArgs<ReturnType<typeof this.argsShape>>,
        { request }: ToolExecutionContext<IMongoDBConfig>
    ): Promise<ToolResult<ReturnType<typeof this.outputSchema>>> {
        const provider = await this.resolveConnection(connectionId);

        this.assertMqlIsAllowed(this.server.config, query);

        // Check if count operation uses an index if enabled
        if (this.server.config.indexCheck) {
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
                            ...(this.server.config.maxTimeMS !== undefined && {
                                maxTimeMS: this.server.config.maxTimeMS,
                            }),
                        },
                        {
                            signal: request.signal,
                        }
                    );
                },
                logger: this.server.logger,
            });
        }

        const count = await provider.countDocuments(database, collection, query, {
            ...this.getOperationOptions(request),
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
