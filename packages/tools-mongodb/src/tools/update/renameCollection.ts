import { z } from "zod";
import {
    CollOperationArgs,
    connectionScopedArgsShape,
    MongoDBToolBase,
    type IMongoDBConfig,
} from "../../mongodbTool.js";
import type { ToolArgs, ToolResult } from "@mongodb-js/mcp-core";
import type { OperationType, ToolExecutionContext } from "@mongodb-js/mcp-types";
import { ErrorCodes, MongoDBError } from "../../common/errors.js";

const RenameCollectionOutputSchema = {
    database: z.string(),
    oldCollection: z.string(),
    newCollection: z.string(),
    renamed: z.boolean(),
};

export type RenameCollectionOutput = z.infer<z.ZodObject<typeof RenameCollectionOutputSchema>>;

const RenameCollectionArgsShapeVariants = connectionScopedArgsShape({
    ...CollOperationArgs,
    newName: z.string().describe("The new name for the collection"),
    dropTarget: z.boolean().optional().default(false).describe("If true, drops the target collection if it exists"),
});

export class RenameCollectionTool extends MongoDBToolBase {
    static toolName = "rename-collection";
    public description = "Renames a collection in a MongoDB database";
    public override outputSchema(): typeof RenameCollectionOutputSchema {
        return RenameCollectionOutputSchema;
    }
    public argsShape(): typeof RenameCollectionArgsShapeVariants.preconfigured {
        return this.selectConnectionScopedArgsShape(RenameCollectionArgsShapeVariants);
    }
    static operationType: OperationType = "update";

    protected async execute(
        { connectionId, database, collection, newName, dropTarget }: ToolArgs<ReturnType<typeof this.argsShape>>,
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        _context: ToolExecutionContext<IMongoDBConfig>
    ): Promise<ToolResult<ReturnType<typeof this.outputSchema>>> {
        if (dropTarget && this.server.config.disabledTools.includes("delete")) {
            // Renaming with `dropTarget: true` drops the existing target collection, which is a
            // destructive delete operation. Since this tool's operation type is `update`, it remains
            // available even when delete operations are disabled, so reject `dropTarget` in that case
            // to prevent it from being used to drop a collection through the back door.
            throw new MongoDBError(
                ErrorCodes.ForbiddenWriteOperation,
                "When 'delete' operations are disabled, you can not rename a collection with 'dropTarget' set to true, as it would drop the target collection."
            );
        }

        const provider = await this.resolveConnection(connectionId);
        const result = await provider.renameCollection(database, collection, newName, {
            dropTarget,
        });

        return {
            content: [
                {
                    text: "The collection was renamed successfully in the requested database.",
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
        args: ToolArgs<ReturnType<typeof this.argsShape>>
    ): Promise<ToolResult<ReturnType<typeof this.outputSchema>>> {
        if (error instanceof Error && "codeName" in error) {
            switch (error.codeName) {
                case "NamespaceNotFound":
                    return {
                        content: [
                            {
                                text: "Cannot rename the requested collection because it doesn't exist.",
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
                    };
                case "NamespaceExists":
                    return {
                        content: [
                            {
                                text: 'Cannot rename the requested collection because the target collection already exists. If you want to overwrite it, set the "dropTarget" argument to true.',
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
                    };
            }
        }

        const parentResult = await super.handleError(error, args);
        return {
            content: parentResult.content ?? [],
            isError: parentResult.isError,
            structuredContent: {
                database: args.database,
                oldCollection: args.collection,
                newCollection: args.newName,
                renamed: false,
            },
        };
    }
}
