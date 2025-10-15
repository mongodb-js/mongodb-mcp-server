import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { type DbOperationArgs, MongoDBToolBase } from "../tools/mongodb/mongodbTool.js";
import type { ToolArgs } from "../tools/tool.js";

export abstract class MongoDBToolWithSearchErrorHandler extends MongoDBToolBase {
    protected handleError(
        error: unknown,
        args: ToolArgs<typeof DbOperationArgs>
    ): Promise<CallToolResult> | CallToolResult {
        const CTA = this.server?.areLocalAtlasToolsAvailable() ? "`atlas-local` tools" : "Atlas CLI";
        if (error instanceof Error && "codeName" in error && error.codeName === "SearchNotEnabled") {
            return {
                content: [
                    {
                        text: `The connected MongoDB deployment does not support vector search indexes. Either connect to a MongoDB Atlas cluster or use the ${CTA} to create and manage a local Atlas deployment.`,
                        type: "text",
                    },
                ],
                isError: true,
            };
        }
        return super.handleError(error, args);
    }
}
