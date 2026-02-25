import { MongoDBToolBase } from "../mongodbTool.js";
import type * as bson from "bson";
import type { OperationType, ToolResult } from "../../tool.js";
import { formatUntrustedData } from "../../tool.js";
import { z } from "zod";

const ListDatabasesOutputSchema = {
    databases: z.array(
        z.object({
            name: z.string(),
            size: z.number(),
        })
    ),
    totalCount: z.number(),
};

export type ListDatabasesOutput = z.infer<z.ZodObject<typeof ListDatabasesOutputSchema>>;

export class ListDatabasesTool extends MongoDBToolBase {
    static toolName = "list-databases";
    public description = "List all databases for a MongoDB connection";
    public argsShape = {};
    public override outputSchema = ListDatabasesOutputSchema;
    static operationType: OperationType = "metadata";

    protected async execute(): Promise<ToolResult<typeof this.outputSchema>> {
        const provider = await this.ensureConnected();
        const dbs = (await provider.listDatabases("")).databases as { name: string; sizeOnDisk: bson.Long }[];
        const databases = dbs.map((db) => ({
            name: db.name,
            size: Number(db.sizeOnDisk),
        }));

        return {
            content: formatUntrustedData(`Found ${databases.length} databases:`, JSON.stringify(databases)),
            structuredContent: {
                databases,
                totalCount: databases.length,
            },
        };
    }
}
