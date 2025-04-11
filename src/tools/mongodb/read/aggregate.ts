import { z } from "zod";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { DbOperationArgs, MongoDBToolBase } from "../mongodbTool.js";
import { ToolArgs, OperationType } from "../../tool.js";

export const AggregateArgs = {
    pipeline: z.array(z.object({}).passthrough()).describe("An array of aggregation stages to execute"),
    limit: z.number().optional().default(10).describe("The maximum number of documents to return"),
};

export class AggregateTool extends MongoDBToolBase {
    protected name = "aggregate";
    protected description = "Run an aggregation against a MongoDB collection";
    protected argsShape = {
        ...DbOperationArgs,
        ...AggregateArgs,
    };
    protected operationType: OperationType = "read";

    protected async execute({
        database,
        collection,
        pipeline,
    }: ToolArgs<typeof this.argsShape>): Promise<CallToolResult> {
        const provider = await this.ensureConnected();
        const documents = await provider.aggregate(database, collection, pipeline).toArray();

        const content: Array<{ text: string; type: "text" }> = [
            {
                text: `Found ${documents.length} documents in the collection \`${collection}\`:`,
                type: "text",
            },
            ...documents.map((doc) => {
                return {
                    text: JSON.stringify(doc),
                    type: "text",
                } as { text: string; type: "text" };
            }),
        ];

        return {
            content,
        };
    }
}
