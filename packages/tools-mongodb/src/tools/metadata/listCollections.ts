import { ConnectionIdArgs, DBOperationArgs, MongoDBToolBase, type IMongoDBConfig } from "../../mongodbTool.js";
import type { ToolArgs, ToolResult } from "@mongodb-js/mcp-core";
import type { OperationType, ToolExecutionContext } from "@mongodb-js/mcp-types";
import { formatUntrustedData } from "@mongodb-js/mcp-core";
import { z } from "zod";

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
    public description = "List all collections for a given database";
    public argsShape = { ...ConnectionIdArgs, ...DBOperationArgs };
    public override outputSchema = ListCollectionsOutputSchema;

    static operationType: OperationType = "metadata";

    protected async execute(
        { connectionId, database }: ToolArgs<typeof this.argsShape>,
        { request }: ToolExecutionContext<IMongoDBConfig>
    ): Promise<ToolResult<typeof this.outputSchema>> {
        const provider = await this.resolveConnection(connectionId);
        const collections = (await provider.listCollections(database, {}, { signal: request.signal })).map((col) => ({
            name: col.name as string,
        }));

        if (collections.length === 0) {
            return {
                content: [
                    {
                        type: "text",
                        text: `Found 0 collections for the requested database. To create a collection, use the "create-collection" tool.`,
                    },
                ],
                structuredContent: {
                    collections: [],
                    totalCount: 0,
                },
            };
        }

        return {
            content: formatUntrustedData(
                `Found ${collections.length} collections in the requested database.`,
                JSON.stringify({ database, collections })
            ),
            structuredContent: {
                collections,
                totalCount: collections.length,
            },
        };
    }
}
