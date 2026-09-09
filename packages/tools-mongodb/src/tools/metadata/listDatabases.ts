import { connectionScopedArgsShape, MongoDBToolBase } from "../../mongodbTool.js";
import type * as bson from "bson";
import type { ToolArgs, ToolResult } from "@mongodb-js/mcp-core";
import type { OperationType } from "@mongodb-js/mcp-types";
import { formatUntrustedData } from "@mongodb-js/mcp-core";
import { z } from "zod";

export const ListDatabasesOutputSchema = {
    databases: z.array(
        z.object({
            name: z.string(),
            size: z.number(),
        })
    ),
    totalCount: z.number(),
};

export type ListDatabasesOutput = z.infer<z.ZodObject<typeof ListDatabasesOutputSchema>>;

const ListDatabasesArgsShapeVariants = connectionScopedArgsShape({});

export class ListDatabasesTool extends MongoDBToolBase {
    static toolName = "list-databases";
    public description = "List all databases for a MongoDB connection";
    public argsShape(): typeof ListDatabasesArgsShapeVariants.preconfigured {
        return this.selectConnectionScopedArgsShape(ListDatabasesArgsShapeVariants);
    }
    public override outputSchema(): typeof ListDatabasesOutputSchema {
        return ListDatabasesOutputSchema;
    }
    static operationType: OperationType = "metadata";

    protected async execute({
        connectionId,
    }: ToolArgs<ReturnType<typeof this.argsShape>>): Promise<ToolResult<ReturnType<typeof this.outputSchema>>> {
        const provider = await this.resolveConnection(connectionId);
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
