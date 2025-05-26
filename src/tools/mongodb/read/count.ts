import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { DbOperationArgs, MongoDBToolBase } from "../mongodbTool.js";
import { ToolArgs, OperationType } from "../../tool.js";
import { z } from "zod";

export const CountArgs = {
    query: z
        .record(z.string(), z.unknown())
        .optional()
        .describe(
            "A filter/query parameter. Allows users to filter the documents to count. Matches the syntax of the filter argument of db.collection.count()."
        ),
};

export class CountTool extends MongoDBToolBase {
    protected name = "count";
    protected description =
        "Gets the number of documents in a MongoDB collection using db.collection.count() and query as an optional filter parameter";
    protected argsShape = {
        ...DbOperationArgs,
        ...CountArgs,
    };

    protected operationType: OperationType = "read";

    protected async execute({ database, collection, query }: ToolArgs<typeof this.argsShape>): Promise<CallToolResult> {
        const provider = await this.ensureConnected();
        const count = await provider.count(database, collection, query);

        return {
            content: [
                {
                    text: `Found ${count} documents in the collection "${collection}"`,
                    type: "text",
                },
            ],
        };
    }
}
