import { DBOperationArgs, MongoDBToolBase } from "../../mongodbTool.js";
import type { ToolArgs, OperationType, ToolExecutionContext, ToolResult } from "@mongodb-js/mcp-core";
import { formatUntrustedData } from "@mongodb-js/mcp-core";
import { EJSON } from "bson";
import z from "zod";

const ListCollectionsOutputSchema = {
    collections: z.array(z.record(z.string(), z.unknown())),
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

        const collections = await provider.listCollections(database, {
            ...this.getOperationOptions(signal),
        });

        return {
            content: formatUntrustedData(
                `Found ${collections.length} collection(s) in database "${database}".`,
                ...(collections.length > 0 ? [EJSON.stringify(collections)] : [])
            ),
            structuredContent: {
                collections,
            },
        };
    }
}
