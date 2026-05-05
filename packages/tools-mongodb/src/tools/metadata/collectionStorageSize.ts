import { CollOperationArgs, MongoDBToolBase } from "../../mongodbTool.js";
import type { ToolArgs, OperationType, ToolExecutionContext, ToolResult } from "@mongodb-js/mcp-core";
import { formatUntrustedData } from "@mongodb-js/mcp-core";
import { EJSON } from "bson";
import z from "zod";

const CollectionStorageSizeOutputSchema = {
    size: z.number(),
    count: z.number(),
    avgObjSize: z.number(),
    storageSize: z.number(),
    totalIndexSize: z.number(),
};

export type CollectionStorageSizeOutput = z.infer<z.ZodObject<typeof CollectionStorageSizeOutputSchema>>;

export class CollectionStorageSizeTool extends MongoDBToolBase {
    static toolName = "collection-storage-size";
    public description = "Get storage statistics for a MongoDB collection";
    public argsShape = {
        ...CollOperationArgs,
    };
    public override outputSchema = CollectionStorageSizeOutputSchema;

    static operationType: OperationType = "metadata";

    protected async execute(
        { database, collection }: ToolArgs<typeof this.argsShape>,
        { signal }: ToolExecutionContext
    ): Promise<ToolResult<typeof this.outputSchema>> {
        const provider = await this.ensureConnected();

        const stats = await provider.runCommandWithCheck(
            database,
            {
                collStats: collection,
            },
            {
                ...this.getOperationOptions(signal),
            }
        );

        return {
            content: formatUntrustedData(
                `Storage statistics for "${database}.${collection}":`,
                EJSON.stringify(stats)
            ),
            structuredContent: {
                size: stats.size as number,
                count: stats.count as number,
                avgObjSize: stats.avgObjSize as number,
                storageSize: stats.storageSize as number,
                totalIndexSize: stats.totalIndexSize as number,
            },
        };
    }
}
