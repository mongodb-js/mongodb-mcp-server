import { z } from "zod";
import { DBOperationArgs, MongoDBToolBase } from "../../mongodbTool.js";
import type { ToolArgs, OperationType, ToolResult } from "@mongodb-js/mcp-core";

const DropDatabaseOutputSchema = {
    database: z.string(),
    dropped: z.boolean(),
};

export type DropDatabaseOutput = z.infer<z.ZodObject<typeof DropDatabaseOutputSchema>>;

export class DropDatabaseTool extends MongoDBToolBase {
    static toolName = "drop-database";
    public description = "Removes the specified database, deleting the associated data files";
    public override outputSchema = DropDatabaseOutputSchema;
    public argsShape = {
        ...DBOperationArgs,
    };
    static operationType: OperationType = "delete";

    protected async execute({
        database,
    }: ToolArgs<typeof this.argsShape>): Promise<ToolResult<typeof this.outputSchema>> {
        const provider = await this.ensureConnected();

        await provider.dropDatabase(database);

        return {
            content: [
                {
                    text: `Successfully dropped database "${database}"`,
                    type: "text",
                },
            ],
            structuredContent: {
                database,
                dropped: true,
            },
        };
    }
}
