import { z } from "zod";
import { DbOperationArgs, MongoDBToolBase } from "../mongodbTool.js";
import type { ToolArgs, OperationType, ToolResult } from "../../tool.js";

const RenameCollectionOutputSchema = {
    database: z.string(),
    oldCollection: z.string(),
    newCollection: z.string(),
    renamed: z.boolean(),
};

export type RenameCollectionOutput = z.infer<z.ZodObject<typeof RenameCollectionOutputSchema>>;

export class RenameCollectionTool extends MongoDBToolBase {
    static toolName = "rename-collection";
    public description = "Renames a collection in a MongoDB database";
    public override outputSchema = RenameCollectionOutputSchema;
    public argsShape = {
        ...DbOperationArgs,
        newName: z.string().describe("The new name for the collection"),
        dropTarget: z.boolean().optional().default(false).describe("If true, drops the target collection if it exists"),
    };
    static operationType: OperationType = "update";

    protected async execute({
        database,
        collection,
        newName,
        dropTarget,
    }: ToolArgs<typeof this.argsShape>): Promise<ToolResult<typeof this.outputSchema>> {
        const provider = await this.ensureConnected();
        const result = await provider.renameCollection(database, collection, newName, {
            dropTarget,
        });

        return {
            content: [
                {
                    text: `Collection "${collection}" renamed to "${result.collectionName}" in database "${database}".`,
                    type: "text",
                },
            ],
            structuredContent: {
                database,
                oldCollection: collection,
                newCollection: result.collectionName,
                renamed: true,
            },
        };
    }

    protected async handleError(
        error: unknown,
        args: ToolArgs<typeof this.argsShape>
    ): Promise<ToolResult<typeof this.outputSchema>> {
        if (error instanceof Error && "codeName" in error) {
            switch (error.codeName) {
                case "NamespaceNotFound":
                    return Promise.resolve({
                        content: [
                            {
                                text: `Cannot rename "${args.database}.${args.collection}" because it doesn't exist.`,
                                type: "text",
                            },
                        ],
                        structuredContent: {
                            database: args.database,
                            oldCollection: args.collection,
                            newCollection: args.newName,
                            renamed: false,
                        },
                        isError: true,
                    });
                case "NamespaceExists":
                    return Promise.resolve({
                        content: [
                            {
                                text: `Cannot rename "${args.database}.${args.collection}" to "${args.newName}" because the target collection already exists. If you want to overwrite it, set the "dropTarget" argument to true.`,
                                type: "text",
                            },
                        ],
                        structuredContent: {
                            database: args.database,
                            oldCollection: args.collection,
                            newCollection: args.newName,
                            renamed: false,
                        },
                        isError: true,
                    });
            }
        }

        // For other errors, call parent but add structured content
        const parentResult = await super.handleError(error, args);
        return {
            content: parentResult.content,
            isError: parentResult.isError,
            structuredContent: {
                database: args.database,
                oldCollection: args.collection,
                newCollection: args.newName,
                renamed: false,
            },
        } as ToolResult<typeof this.outputSchema>;
    }
}
