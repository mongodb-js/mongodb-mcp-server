import { CollOperationArgs, ConnectionIdArgs, MongoDBToolBase, type IMongoDBConfig } from "../../mongodbTool.js";
import type { ToolArgs, ToolResult } from "@mongodb-js/mcp-core";
import type { OperationType, ToolExecutionContext } from "@mongodb-js/mcp-types";
import { checkIndexUsage } from "../../helpers/indexCheck.js";
import { escapeMarkdown } from "../../helpers/escapeMarkdown.js";
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

    protected async execute(
        { connectionId, database, collection, filter }: ToolArgs<typeof this.argsShape>,
        { request }: ToolExecutionContext<IMongoDBConfig>
    ): Promise<ToolResult<typeof this.outputSchema>> {
        const provider = await this.resolveConnection(connectionId);

        this.assertMqlIsAllowed(request.server.config, filter);

        // Check if delete operation uses an index if enabled
        if (request.server.config.indexCheck) {
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
                        ...(request.server.config.maxTimeMS !== undefined && { maxTimeMS: request.server.config.maxTimeMS }),
                    });
                },
                logger: this.server.logger,
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
