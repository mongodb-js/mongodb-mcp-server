import { CollOperationArgs, MongoDBToolBase } from "../../mongodbTool.js";
import type { ToolArgs, OperationType, ToolExecutionContext, ToolResult } from "@mongodb-js/mcp-core";
import { formatUntrustedData } from "@mongodb-js/mcp-core";
import { zEJSON } from "../../../args.js";
import { EJSON } from "bson";
import z from "zod";

const ExplainOutputSchema = {
    explained: z.record(z.string(), z.unknown()),
};

export type ExplainOutput = z.infer<z.ZodObject<typeof ExplainOutputSchema>>;

export class ExplainTool extends MongoDBToolBase {
    static toolName = "explain";
    public description = "Get the query plan for an operation";
    public argsShape = {
        ...CollOperationArgs,
        command: zEJSON().describe(
            "The command to explain, such as { find: 'coll', filter: { a: 1 } } or { aggregate: 'coll', pipeline: [...] }"
        ),
        verbosity: z
            .enum(["queryPlanner", "executionStats", "allPlansExecution"])
            .optional()
            .default("queryPlanner")
            .describe("The verbosity level for the explain output"),
    };
    public override outputSchema = ExplainOutputSchema;

    static operationType: OperationType = "metadata";

    protected async execute(
        { database, command, verbosity }: ToolArgs<typeof this.argsShape>,
        { signal }: ToolExecutionContext
    ): Promise<ToolResult<typeof this.outputSchema>> {
        const provider = await this.ensureConnected();

        const result = await provider.runCommandWithCheck(
            database,
            {
                explain: command,
                verbosity,
            },
            {
                ...this.getOperationOptions(signal),
            }
        );

        return {
            content: formatUntrustedData(
                `Explain output for ${Object.keys(command)[0]} operation:`,
                EJSON.stringify(result)
            ),
            structuredContent: {
                explained: result,
            },
        };
    }
}
