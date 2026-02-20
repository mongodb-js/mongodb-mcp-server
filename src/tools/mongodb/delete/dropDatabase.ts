import { DbOperationArgs, MongoDBToolBase } from "../mongodbTool.js";
import type { ToolArgs, OperationType, ToolResult } from "../../tool.js";
import { z } from "zod";

const DropDatabaseOutputSchema = {
    database: z.string(),
    dropped: z.boolean(),
};

export type DropDatabaseOutput = z.infer<z.ZodObject<typeof DropDatabaseOutputSchema>>;

export class DropDatabaseTool extends MongoDBToolBase {
    static toolName = "drop-database";
    public description = "Removes the specified database, deleting the associated data files";
    public argsShape = {
        database: DbOperationArgs.database,
    };
    public override outputSchema = DropDatabaseOutputSchema;
    static operationType: OperationType = "delete";

    protected async execute({
        database,
    }: ToolArgs<typeof this.argsShape>): Promise<ToolResult<typeof this.outputSchema>> {
        const provider = await this.ensureConnected();
        const result = await provider.dropDatabase(database);

        return {
            content: [
                {
                    text: `${result.ok ? "Successfully dropped" : "Failed to drop"} database "${database}"`,
                    type: "text",
                },
            ],
            structuredContent: {
                database,
                dropped: Boolean(result.ok),
            },
        };
    }

    protected getConfirmationMessage({ database }: ToolArgs<typeof this.argsShape>): string {
        return (
            `You are about to drop the \`${database}\` database:\n\n` +
            "This operation will permanently remove the database and ALL its collections, documents, and indexes.\n\n" +
            "**Do you confirm the execution of the action?**"
        );
    }
}
