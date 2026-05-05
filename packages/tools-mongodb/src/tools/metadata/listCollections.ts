import { z } from "zod";
import { DBOperationArgs, MongoDBToolBase } from "../../mongodbTool.js";
import type { ToolArgs, OperationType, ToolExecutionContext, ToolResult } from "@mongodb-js/mcp-core";
import { formatUntrustedData } from "@mongodb-js/mcp-core";
import { EJSON } from "bson";

const ListCollectionsOutputSchema = {
    collections: z.array(
        z.object({
            name: z.string(),
        })
    ),
    totalCount: z.number(),
};

export type ListCollectionsOutput = z.infer<z.ZodObject<typeof ListCollectionsOutputSchema>>;

export class ListCollectionsTool extends MongoDBToolBase {
    static toolName = "list-collections";
    public description = "List all collections in a MongoDB database";
    public argsShape = {
        ...DBOperationArgs,
    };
    public override outputSchema = ListCollectionsOutputSchema;

    static operationType: OperationType = "metadata";

    protected async execute(
        { database }: ToolArgs<typeof this.argsShape>,
        { signal }: ToolExecutionContext
    ): Promise<ToolResult<typeof this.outputSchema>> {
        const provider = await this.ensureConnected();

        const collections = (await provider.listCollections(database, {
            ...this.getOperationOptions(signal),
        })) as Array<{ name: string }>;

        const collectionsData = collections.map((coll) => ({ name: coll.name }));

        return {
            content: formatUntrustedData(
                `Found ${collections.length} collections for database "${database}".`,
                ...(collections.length > 0 ? [EJSON.stringify(collectionsData)] : [])
            ),
            structuredContent: {
                collections: collectionsData,
                totalCount: collections.length,
            },
        };
    }
}
