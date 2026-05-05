import { CollOperationArgs, MongoDBToolBase } from "../../mongodbTool.js";
import type { ToolArgs, OperationType, ToolExecutionContext, ToolResult } from "@mongodb-js/mcp-core";
import { formatUntrustedData } from "@mongodb-js/mcp-core";
import { EJSON } from "bson";
import z from "zod";

const CollectionIndexesOutputSchema = {
    indexes: z.array(z.record(z.string(), z.unknown())),
};

export type CollectionIndexesOutput = z.infer<z.ZodObject<typeof CollectionIndexesOutputSchema>>;

export class CollectionIndexesTool extends MongoDBToolBase {
    static toolName = "collection-indexes";
    public description = "List all indexes for a MongoDB collection";
    public argsShape = {
        ...CollOperationArgs,
    };
    public override outputSchema = CollectionIndexesOutputSchema;

    static operationType: OperationType = "metadata";

    protected async execute(
        { database, collection }: ToolArgs<typeof this.argsShape>,
        { signal }: ToolExecutionContext
    ): Promise<ToolResult<typeof this.outputSchema>> {
        const provider = await this.ensureConnected();

        const indexes = await provider.getIndexes(database, collection, {
            ...this.getOperationOptions(signal),
        });

        return {
            content: formatUntrustedData(
                `Found ${indexes.length} index(es) in collection "${collection}".`,
                ...(indexes.length > 0 ? [EJSON.stringify(indexes)] : [])
            ),
            structuredContent: {
                indexes,
            },
        };
    }
}
