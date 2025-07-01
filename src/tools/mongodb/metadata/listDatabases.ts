import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { MongoDBToolBase } from "../mongodbTool.js";
import * as bson from "bson";
import { OperationType } from "../../tool.js";

export function listDatabasesResponse(databases: { name: string; sizeOnDisk: string }[]): CallToolResult {
    return {
        content: databases.map((db) => {
            return {
                text: `Name: ${db.name}, Size: ${db.sizeOnDisk} bytes`,
                type: "text",
            };
        }),
    };
}

export class ListDatabasesTool extends MongoDBToolBase {
    protected name = "list-databases";
    protected description = "List all databases for a MongoDB connection";
    protected argsShape = {};
    protected operationType: OperationType = "metadata";

    protected async execute(): Promise<CallToolResult> {
        const provider = await this.ensureConnected();
        const dbs = (await provider.listDatabases("")).databases as { name: string; sizeOnDisk: bson.Long }[];

        return listDatabasesResponse(
            dbs.map((db) => {
                return {
                    name: db.name,
                    sizeOnDisk: db.sizeOnDisk.toString(),
                };
            })
        );
    }
}
