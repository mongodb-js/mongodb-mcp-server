import { CollOperationArgs, MongoDBToolBase } from "../../mongodbTool.js";
import type { ToolArgs, OperationType, ToolExecutionContext, ToolResult } from "@mongodb-js/mcp-core";
import { formatUntrustedData } from "@mongodb-js/mcp-core";
import { EJSON } from "bson";
import z from "zod";
import { zEJSON } from "../../args.js";

const ExplainOutputSchema = {
    method: z.enum(["aggregate", "find", "count", "distinct", "group", "remove", "update"]),
    verbosity: z.enum(["queryPlanner", "executionStats", "allPlansExecution"]),
    explainResult: z.record(z.string(), z.unknown()),
};

export type ExplainOutput = z.infer<z.ZodObject<typeof ExplainOutputSchema>>;

export class ExplainTool extends MongoDBToolBase {
    static toolName = "explain";
    public description = "Get the explain plan for a MongoDB operation";
    public argsShape = {
        ...CollOperationArgs,
        method: z
            .enum(["aggregate", "find", "count", "distinct", "group", "remove", "update"])
            .describe("The method to explain"),
        query: zEJSON().optional().describe("The query/filter to explain (for find, count, distinct, etc.)"),
        pipeline: z.array(z.unknown()).optional().describe("The aggregation pipeline to explain (for aggregate)"),
        verbosity: z
            .enum(["queryPlanner", "executionStats", "allPlansExecution"])
            .optional()
            .default("queryPlanner")
            .describe("The verbosity level for the explain output"),
    };
    public override outputSchema = ExplainOutputSchema;

    static operationType: OperationType = "metadata";

    protected async execute(
        { database, collection, method, query, pipeline, verbosity }: ToolArgs<typeof this.argsShape>,
        { signal }: ToolExecutionContext
    ): Promise<ToolResult<typeof this.outputSchema>> {
        const provider = await this.ensureConnected();

        // Build the explain command
        const explainTarget: Record<string, unknown> =
            method === "aggregate" && pipeline
                ? { aggregate: collection, pipeline, cursor: {} }
                : { [method]: collection, ...(query && { query }) };

        const explained = await provider.runCommandWithCheck(
            database,
            {
                explain: explainTarget,
                verbosity,
            },
            {
                ...this.getOperationOptions(signal),
            }
        );

        return {
            content: formatUntrustedData(
                `Explain plan for ${method} on "${database}.${collection}":`,
                EJSON.stringify(explained)
            ),
            structuredContent: {
                method,
                verbosity,
                explainResult: explained,
            },
        };
    }
}
