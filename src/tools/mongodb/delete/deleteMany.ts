import { CollOperationArgs, ConnectionIdArgs, MongoDBToolBase } from "../mongodbTool.js";
import type { ToolArgs, OperationType, ToolResult } from "../../tool.js";
import { checkIndexUsage } from "../../../helpers/indexCheck.js";
import { escapeMarkdown } from "../../../helpers/escapeMarkdown.js";
import { EJSON } from "bson";
import { zEJSON } from "../../args.js";
import { z } from "zod";

const DeleteManyOutputSchema = {
    database: z.string(),
    collection: z.string(),
    deletedCount: z.number(),
};

export type DeleteManyOutput = z.infer<z.ZodObject<typeof DeleteManyOutputSchema>>;

export class DeleteManyTool extends MongoDBToolBase {
    static toolName = "delete-many";
    public description = "Removes all documents that match the filter from a MongoDB collection";
    public argsShape = {
        ...ConnectionIdArgs,
        ...CollOperationArgs,
        filter: zEJSON()
            .optional()
            .describe(
                "The query filter, specifying the deletion criteria. Matches the syntax of the filter argument of db.collection.deleteMany()"
            ),
    };
    public override outputSchema = DeleteManyOutputSchema;
    static operationType: OperationType = "delete";

    protected async execute(args: ToolArgs<typeof this.argsShape>): Promise<ToolResult<typeof this.outputSchema>> {
        const { database, collection, filter } = args;
        const provider = await this.resolveConnection(args);

        this.assertMqlIsAllowed(filter);

        // Check if delete operation uses an index if enabled
        if (this.config.indexCheck) {
            await checkIndexUsage({
                database,
                collection,
                operation: "deleteMany",
                explainCallback: async () => {
                    return provider.runCommandWithCheck(database, {
                        explain: {
                            delete: collection,
                            deletes: [
                                {
                                    q: filter || {},
                                    limit: 0, // 0 means delete all matching documents
                                },
                            ],
                        },
                        verbosity: "queryPlanner",
                        ...(this.config.maxTimeMS !== undefined && { maxTimeMS: this.config.maxTimeMS }),
                    });
                },
                logger: this.session.logger,
            });
        }

        const result = await provider.deleteMany(database, collection, filter);

        return {
            content: [
                {
                    text: `Deleted \`${result.deletedCount}\` document(s) from the requested collection.`,
                    type: "text",
                },
            ],
            structuredContent: {
                database,
                collection,
                deletedCount: result.deletedCount,
            },
        };
    }

    protected getConfirmationMessage({ database, collection, filter }: ToolArgs<typeof this.argsShape>): string {
        // The filter is untrusted (model-supplied). It is not rendered inside a markdown code fence
        // because fences/code-spans cannot be escaped with backslashes — a backtick sequence in the
        // payload would break out. Rendering it as escapeMarkdown'd plain text neutralizes backticks too.
        const filterDescription =
            filter && Object.keys(filter).length > 0
                ? `- **Filter**: ${escapeMarkdown(`{ "filter": ${EJSON.stringify(filter)} }`)}\n\n`
                : "- **All documents** (No filter)\n\n";
        return (
            `You are about to delete documents from the **${escapeMarkdown(collection)}** collection in the **${escapeMarkdown(database)}** database:\n\n` +
            filterDescription +
            "This operation will permanently remove all documents matching the filter.\n\n" +
            "**Do you confirm the execution of the action?**"
        );
    }
}
