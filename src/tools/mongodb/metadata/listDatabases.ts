import { MongoDBToolBase } from "../mongodbTool.js";
import type * as bson from "bson";
import type { OperationType, ToolResult } from "../../tool.js";
import { formatUntrustedData } from "../../tool.js";
import z, { type ZodNever } from "zod";

export const ListDatabasesToolOutputShape = {
    dbs: z.array(z.object({ name: z.string(), sizeOnDisk: z.string(), sizeUnit: z.literal("bytes") })),
};

export type ListDatabasesToolOutput = z.objectOutputType<typeof ListDatabasesToolOutputShape, ZodNever>;

export class ListDatabasesTool extends MongoDBToolBase {
    public name = "list-databases";
    protected description = "List all databases for a MongoDB connection";
    protected argsShape = {};
    protected outputShape = ListDatabasesToolOutputShape;
    static operationType: OperationType = "metadata";

    protected async execute(): Promise<ToolResult<typeof this.outputShape>> {
        const provider = await this.ensureConnected();
        const dbs = ((await provider.listDatabases("")).databases as { name: string; sizeOnDisk: bson.Long }[]).map(
            (db) => ({ name: db.name, sizeOnDisk: db.sizeOnDisk.toString(), sizeUnit: "bytes" as const })
        );

        return {
            content: formatUntrustedData(`Found ${dbs.length} databases`, JSON.stringify(dbs)),
            structuredContent: { dbs },
        };
    }
}
