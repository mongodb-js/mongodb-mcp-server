import { CollOperationArgs, MongoDBToolBase } from "../../mongodbTool.js";
import type { ToolArgs, OperationType, ToolExecutionContext, ToolResult } from "@mongodb-js/mcp-core";
import { formatUntrustedData } from "@mongodb-js/mcp-core";
import z from "zod";

const CollectionStorageSizeOutputSchema = {
    size: z.number(),
    count: z.number(),
    avgObjSize: z.number(),
    storageSize: z.number(),
    totalIndexSize: z.number(),
    units: z.string(),
};

export type CollectionStorageSizeOutput = z.infer<z.ZodObject<typeof CollectionStorageSizeOutputSchema>>;

export class CollectionStorageSizeTool extends MongoDBToolBase {
    static toolName = "collection-storage-size";
    public description = "Get the storage size statistics for a MongoDB collection";
    public argsShape = {
        ...CollOperationArgs,
        scale: z.enum(["MB", "GB"]).optional().default("MB").describe("The scale to use for the size (MB or GB)"),
    };
    public override outputSchema = CollectionStorageSizeOutputSchema;

    static operationType: OperationType = "metadata";

    protected async execute(
        { database, collection, scale }: ToolArgs<typeof this.argsShape>,
        { signal }: ToolExecutionContext
    ): Promise<ToolResult<typeof this.outputSchema>> {
        const provider = await this.ensureConnected();

        const stats = (await provider.runCommandWithCheck(
            database,
            { collStats: collection },
            {
                ...this.getOperationOptions(signal),
            }
        )) as {
            count: number;
            avgObjSize: number;
            storageSize: number;
            totalIndexSize: number;
        };

        const scaleFactor = scale === "GB" ? 1024 * 1024 * 1024 : 1024 * 1024;
        const size = stats.storageSize / scaleFactor;

        return {
            content: formatUntrustedData(
                `Storage statistics for "${database}.${collection}":`,
                JSON.stringify({
                    size,
                    units: scale,
                    count: stats.count,
                    avgObjSize: stats.avgObjSize,
                    storageSize: stats.storageSize,
                    totalIndexSize: stats.totalIndexSize,
                })
            ),
            structuredContent: {
                size,
                count: stats.count,
                avgObjSize: stats.avgObjSize,
                storageSize: stats.storageSize,
                totalIndexSize: stats.totalIndexSize,
                units: scale,
            },
        };
    }
}
