import { MongoDBToolBase } from "../../mongodbTool.js";
import type { ToolArgs, OperationType, ToolExecutionContext, ToolResult } from "@mongodb-js/mcp-core";
import { formatUntrustedData } from "@mongodb-js/mcp-core";
import { EJSON } from "bson";
import z from "zod";

const ListDatabasesOutputSchema = {
    databases: z.array(z.record(z.string(), z.unknown())),
};

export type ListDatabasesOutput = z.infer<z.ZodObject<typeof ListDatabasesOutputSchema>>;

export class ListDatabasesTool extends MongoDBToolBase {
    static toolName = "list-databases";
    public description = "List all databases in the MongoDB instance";
    public argsShape = {};
    public override outputSchema = ListDatabasesOutputSchema;

    static operationType: OperationType = "metadata";

    protected async execute(
        _args: ToolArgs<typeof this.argsShape>,
        { signal }: ToolExecutionContext
    ): Promise<ToolResult<typeof this.outputSchema>> {
        const provider = await this.ensureConnected();

        const result = await provider.listDatabases("", {
            ...this.getOperationOptions(signal),
        });

        const databases = (result.databases || []) as Record<string, unknown>[];

        return {
            content: formatUntrustedData(
                `Found ${databases.length} database(s) in the MongoDB instance.`,
                ...(databases.length > 0 ? [EJSON.stringify(databases)] : [])
            ),
            structuredContent: {
                databases,
            },
        };
    }
}
