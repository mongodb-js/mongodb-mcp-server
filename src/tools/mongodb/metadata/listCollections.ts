import { DbOperationArgs, MongoDBToolBase } from "../mongodbTool.js";
import type { ToolArgs, OperationType, ToolExecutionContext, ToolResult } from "../../tool.js";
import { formatUntrustedData } from "../../tool.js";
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
    public argsShape = {
        database: DbOperationArgs.database,
    };
    public override outputSchema = ListCollectionsOutputSchema;

    static operationType: OperationType = "metadata";

    protected async execute(
        { database }: ToolArgs<typeof this.argsShape>,
        { signal }: ToolExecutionContext
    ): Promise<ToolResult<typeof this.outputSchema>> {
        const provider = await this.ensureConnected();
        const collections = (await provider.listCollections(database, {}, { signal })).map((col) => ({
            name: col.name as string,
        }));

        if (collections.length === 0) {
            const dbs = (await provider.listDatabases("")).databases as { name: string }[];
            const databaseExists = dbs.some((db) => db.name === database);
            const message = databaseExists
                ? `Found 0 collections for database "${database}". To create a collection, use the "create-collection" tool.`
                : `No collections found. The database "${database}" does not exist. To create a collection, use the "create-collection" tool.`;
            return {
                content: [
                    {
                        type: "text",
                        text: message,
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
                `Found ${collections.length} collections for database "${database}".`,
                JSON.stringify(collections)
            ),
            structuredContent: {
                collections,
                totalCount: collections.length,
            },
        };
    }
}
